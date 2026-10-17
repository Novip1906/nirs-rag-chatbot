package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

var (
	ErrInvalidToken     = errors.New("invalid token")
	ErrTokenExpired     = errors.New("token expired")
	ErrUnknownKey       = errors.New("unknown signing key")
	ErrIssuerMismatch   = errors.New("issuer mismatch")
	ErrAudienceMismatch = errors.New("audience mismatch")
	ErrKeysUnavailable  = errors.New("signing keys unavailable")
)

var allowedAlgorithms = []jose.SignatureAlgorithm{jose.RS256, jose.ES256}

const (
	defaultJWKSTTL      = 30 * time.Minute
	defaultJWKSCooldown = 30 * time.Second
	defaultJWKSColdWait = time.Second
	jwksFetchTimeout    = 5 * time.Second
	jwksMaxBodyBytes    = 1 << 20
	notBeforeLeeway     = 30 * time.Second
	signatureKeyUse     = "sig"
)

var jwksHTTPClient = &http.Client{Timeout: jwksFetchTimeout}

type JWKSValidator struct {
	issuer string

	mu          sync.RWMutex
	keys        jose.JSONWebKeySet
	loaded      bool
	attemptedAt time.Time
	inflight    chan struct{}

	fetch func() (jose.JSONWebKeySet, error)

	ttl      time.Duration
	cooldown time.Duration
	coldWait time.Duration
}

func NewJWKSValidatorFromKeySet(keys jose.JSONWebKeySet, issuer string) *JWKSValidator {
	return &JWKSValidator{issuer: issuer, keys: keys, loaded: true, attemptedAt: time.Now()}
}

func NewJWKSValidatorFromURL(url, issuer string) *JWKSValidator {
	return &JWKSValidator{
		issuer:   issuer,
		ttl:      defaultJWKSTTL,
		cooldown: defaultJWKSCooldown,
		coldWait: defaultJWKSColdWait,
		fetch: func() (jose.JSONWebKeySet, error) {
			return fetchJWKS(url)
		},
	}
}

func (v *JWKSValidator) Validate(token string) (map[string]any, error) {
	jws, err := jose.ParseSignedCompact(token, allowedAlgorithms)
	if err != nil || len(jws.Signatures) != 1 {
		return nil, ErrInvalidToken
	}

	header := jws.Signatures[0].Header
	if header.KeyID == "" {
		return nil, ErrUnknownKey
	}

	claims, err := v.verifyWith(jws, header, false)
	if errors.Is(err, ErrUnknownKey) {
		claims, err = v.verifyWith(jws, header, true)
	}
	return claims, err
}

func (v *JWKSValidator) verifyWith(jws *jose.JSONWebSignature, header jose.Header, force bool) (map[string]any, error) {
	keys, err := v.keySet(force)
	if err != nil {
		return nil, err
	}

	candidates := signingCandidates(keys, header)
	if len(candidates) == 0 {
		return nil, ErrUnknownKey
	}

	var payload []byte
	for i := range candidates {
		if p, verr := jws.Verify(candidates[i]); verr == nil {
			payload = p
			break
		}
	}
	if payload == nil {
		return nil, ErrInvalidToken
	}

	claims := map[string]any{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, ErrInvalidToken
	}
	if err := v.verifyStandardClaims(claims); err != nil {
		return nil, err
	}
	return claims, nil
}

func signingCandidates(keys jose.JSONWebKeySet, header jose.Header) []jose.JSONWebKey {
	matched := keys.Key(header.KeyID)

	candidates := make([]jose.JSONWebKey, 0, len(matched))
	for i := range matched {
		if matched[i].Use != "" && matched[i].Use != signatureKeyUse {
			continue
		}
		if matched[i].Algorithm != "" && matched[i].Algorithm != header.Algorithm {
			continue
		}

		public := matched[i].Public()
		if !public.Valid() || !public.IsPublic() {
			continue
		}
		candidates = append(candidates, public)
	}
	return candidates
}

func (v *JWKSValidator) verifyStandardClaims(claims map[string]any) error {
	exp, ok := claims["exp"].(float64)
	if !ok {
		return ErrInvalidToken
	}
	now := time.Now().UTC()
	if now.After(time.Unix(int64(exp), 0)) {
		return ErrTokenExpired
	}
	if nbf, ok := claims["nbf"].(float64); ok && now.Add(notBeforeLeeway).Before(time.Unix(int64(nbf), 0)) {
		return ErrInvalidToken
	}
	if v.issuer != "" {
		iss, ok := claims["iss"].(string)
		if !ok || iss != v.issuer {
			return ErrIssuerMismatch
		}
	}
	if sub, ok := claims["sub"].(string); !ok || sub == "" {
		return ErrInvalidToken
	}
	return nil
}

func (v *JWKSValidator) keySet(force bool) (jose.JSONWebKeySet, error) {
	v.mu.RLock()
	if v.loaded && !v.needsFetch(force) {
		keys := v.keys
		v.mu.RUnlock()
		return keys, nil
	}
	v.mu.RUnlock()

	v.mu.Lock()
	if wait := v.inflight; wait != nil {
		v.mu.Unlock()
		<-wait
		return v.cachedKeys()
	}
	if v.fetch == nil || !v.needsFetch(force) {
		v.mu.Unlock()
		return v.cachedKeys()
	}

	done := make(chan struct{})
	v.inflight = done
	fetch := v.fetch
	v.mu.Unlock()

	keys, err := v.runFetch(fetch, done)
	if err != nil {
		return v.cachedKeys()
	}
	return keys, nil
}

func (v *JWKSValidator) runFetch(fetch func() (jose.JSONWebKeySet, error), done chan struct{}) (keys jose.JSONWebKeySet, err error) {
	defer func() {
		v.mu.Lock()
		if err == nil && len(keys.Keys) > 0 {
			v.keys = keys
			v.loaded = true
		}
		v.attemptedAt = time.Now()
		v.inflight = nil
		v.mu.Unlock()

		if err != nil {
			slog.Error("auth: jwks fetch failed", "issuer", v.issuer, "error", err.Error())
		}
		close(done)
	}()

	keys, err = fetch()
	if err == nil && len(keys.Keys) == 0 {
		err = ErrKeysUnavailable
	}
	return keys, err
}

func (v *JWKSValidator) Warmup() error {
	_, err := v.keySet(false)
	return err
}

func (v *JWKSValidator) cachedKeys() (jose.JSONWebKeySet, error) {
	v.mu.RLock()
	defer v.mu.RUnlock()

	if v.loaded {
		return v.keys, nil
	}
	return jose.JSONWebKeySet{}, ErrKeysUnavailable
}

func (v *JWKSValidator) needsFetch(force bool) bool {
	if v.attemptedAt.IsZero() {
		return true
	}
	if !v.loaded {
		return time.Since(v.attemptedAt) >= v.coldWait
	}
	if force {
		return v.cooldown <= 0 || time.Since(v.attemptedAt) >= v.cooldown
	}
	return v.ttl > 0 && time.Since(v.attemptedAt) >= v.ttl
}

func fetchJWKS(url string) (jose.JSONWebKeySet, error) {
	resp, err := jwksHTTPClient.Get(url)
	if err != nil {
		return jose.JSONWebKeySet{}, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return jose.JSONWebKeySet{}, fmt.Errorf("jwks: unexpected status %d from %s", resp.StatusCode, url)
	}

	var keys jose.JSONWebKeySet
	if err := json.NewDecoder(io.LimitReader(resp.Body, jwksMaxBodyBytes)).Decode(&keys); err != nil {
		return jose.JSONWebKeySet{}, err
	}
	if len(keys.Keys) == 0 {
		return jose.JSONWebKeySet{}, fmt.Errorf("jwks: empty key set from %s", url)
	}
	return keys, nil
}
