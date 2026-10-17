package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/stretchr/testify/require"
)

func sign(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: key},
		(&jose.SignerOptions{}).WithHeader("kid", kid).WithType("JWT"),
	)
	require.NoError(t, err)

	token, err := jwt.Signed(signer).Claims(claims).Serialize()
	require.NoError(t, err)
	return token
}

func publicSet(kid string, key *rsa.PrivateKey) jose.JSONWebKeySet {
	return jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: key.Public(), KeyID: kid, Algorithm: string(jose.RS256), Use: "sig"}}}
}

func TestValidate_RefetchesOnUnknownKid(t *testing.T) {
	oldKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	current := publicSet("old", oldKey)
	fetches := 0
	v := &JWKSValidator{
		issuer: "iss",
		fetch: func() (jose.JSONWebKeySet, error) {
			fetches++
			return current, nil
		},
	}
	claims := map[string]any{"sub": "u1", "iss": "iss", "exp": float64(time.Now().Add(time.Hour).Unix())}

	got, err := v.Validate(sign(t, oldKey, "old", claims))
	require.NoError(t, err)
	require.Equal(t, "u1", got["sub"])
	require.Equal(t, 1, fetches)

	current = publicSet("new", newKey)
	got, err = v.Validate(sign(t, newKey, "new", claims))
	require.NoError(t, err)
	require.Equal(t, "u1", got["sub"])
	require.Equal(t, 2, fetches)
}

func TestValidate_RejectsExpiredAndWrongIssuer(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	_, err = v.Validate(sign(t, key, "k", map[string]any{"iss": "iss", "exp": float64(time.Now().Add(-time.Minute).Unix())}))
	require.ErrorIs(t, err, ErrTokenExpired)

	_, err = v.Validate(sign(t, key, "k", map[string]any{"iss": "other", "exp": float64(time.Now().Add(time.Hour).Unix())}))
	require.ErrorIs(t, err, ErrIssuerMismatch)
}

func TestValidate_CooldownBlocksRepeatedRefetch(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	fetches := 0
	v := &JWKSValidator{
		cooldown: time.Hour,
		fetch: func() (jose.JSONWebKeySet, error) {
			fetches++
			return publicSet("k", key), nil
		},
	}
	claims := map[string]any{"sub": "u1", "exp": float64(time.Now().Add(time.Hour).Unix())}

	_, err = v.Validate(sign(t, key, "k", claims))
	require.NoError(t, err)
	_, err = v.Validate(sign(t, key, "unknown", claims))
	require.ErrorIs(t, err, ErrUnknownKey)
	require.Equal(t, 1, fetches)
}

func futureClaims() map[string]any {
	return map[string]any{"sub": "u1", "iss": "iss", "exp": float64(time.Now().Add(time.Hour).Unix())}
}

func requireRejectedByAlgorithmAllowlist(t *testing.T, token string, got jose.SignatureAlgorithm) {
	t.Helper()

	var algErr *jose.ErrUnexpectedSignatureAlgorithm
	_, err := jose.ParseSignedCompact(token, allowedAlgorithms)
	require.ErrorAs(t, err, &algErr)
	require.Equal(t, got, algErr.Got)

	_, err = jose.ParseSignedCompact(token, []jose.SignatureAlgorithm{got})
	require.NoError(t, err)
}

func TestValidate_RejectsUnsignedToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	header, err := json.Marshal(map[string]any{"alg": "none", "typ": "JWT", "kid": "k"})
	require.NoError(t, err)
	payload, err := json.Marshal(futureClaims())
	require.NoError(t, err)
	enc := base64.RawURLEncoding
	unsigned := enc.EncodeToString(header) + "." + enc.EncodeToString(payload) + "."

	requireRejectedByAlgorithmAllowlist(t, unsigned, "none")

	_, err = v.Validate(unsigned)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestValidate_RejectsHMACSignedWithPublicKey(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	secret, err := x509.MarshalPKIXPublicKey(key.Public())
	require.NoError(t, err)

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.HS256, Key: secret},
		(&jose.SignerOptions{}).WithHeader("kid", "k").WithType("JWT"),
	)
	require.NoError(t, err)
	forged, err := jwt.Signed(signer).Claims(futureClaims()).Serialize()
	require.NoError(t, err)

	requireRejectedByAlgorithmAllowlist(t, forged, jose.HS256)

	_, err = v.Validate(forged)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func flipFirstChar(s string) string {
	if s[0] == 'A' {
		return "B" + s[1:]
	}
	return "A" + s[1:]
}

func TestValidate_RejectsTamperedToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	for name, part := range map[string]int{"payload": 1, "signature": 2} {
		t.Run(name, func(t *testing.T) {
			parts := strings.Split(sign(t, key, "k", futureClaims()), ".")
			require.Len(t, parts, 3)
			parts[part] = flipFirstChar(parts[part])

			_, err := v.Validate(strings.Join(parts, "."))
			require.ErrorIs(t, err, ErrInvalidToken)
		})
	}
}

func TestValidate_RejectsForeignKey(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	attacker, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	_, err = v.Validate(sign(t, attacker, "k", futureClaims()))
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestValidate_RejectsMissingKid(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	_, err = v.Validate(sign(t, key, "", futureClaims()))
	require.ErrorIs(t, err, ErrUnknownKey)
}

func TestValidate_RejectsEncryptionKeyWithMatchingKid(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	keys := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
		{Key: key.Public(), KeyID: "k", Algorithm: "RSA-OAEP", Use: "enc"},
	}}
	v := NewJWKSValidatorFromKeySet(keys, "iss")

	_, err = v.Validate(sign(t, key, "k", futureClaims()))
	require.ErrorIs(t, err, ErrUnknownKey)
}

func TestValidate_RejectsMissingExpiry(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	_, err = v.Validate(sign(t, key, "k", map[string]any{"sub": "u1", "iss": "iss"}))
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestValidate_RejectsGarbage(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	for _, token := range []string{"", "not-a-token", "a.b", "a.b.c.d"} {
		_, err = v.Validate(token)
		require.ErrorIs(t, err, ErrInvalidToken)
	}
}

func TestValidate_ColdStartFetchFailureIsThrottled(t *testing.T) {
	fetches := 0
	v := &JWKSValidator{
		issuer:   "iss",
		cooldown: time.Hour,
		ttl:      time.Hour,
		coldWait: time.Hour,
		fetch: func() (jose.JSONWebKeySet, error) {
			fetches++
			return jose.JSONWebKeySet{}, errors.New("jwks unreachable from http://keycloak/realms/corporate")
		},
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	token := sign(t, key, "k", futureClaims())

	_, err = v.Validate(token)
	require.ErrorIs(t, err, ErrKeysUnavailable)
	require.NotContains(t, err.Error(), "keycloak")

	_, err = v.Validate(token)
	require.ErrorIs(t, err, ErrKeysUnavailable)
	require.Equal(t, 1, fetches)
}

func TestValidate_ColdStartRetriesAfterColdWait(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	const coldWait = 10 * time.Millisecond
	fetches := 0
	v := &JWKSValidator{
		issuer:   "iss",
		cooldown: time.Hour,
		ttl:      time.Hour,
		coldWait: coldWait,
		fetch: func() (jose.JSONWebKeySet, error) {
			fetches++
			if fetches == 1 {
				return jose.JSONWebKeySet{}, errors.New("jwks unreachable")
			}
			return publicSet("k", key), nil
		},
	}
	token := sign(t, key, "k", futureClaims())

	_, err = v.Validate(token)
	require.ErrorIs(t, err, ErrKeysUnavailable)
	require.Equal(t, 1, fetches)

	_, err = v.Validate(token)
	require.ErrorIs(t, err, ErrKeysUnavailable)
	require.Equal(t, 1, fetches)

	time.Sleep(2 * coldWait)

	claims, err := v.Validate(token)
	require.NoError(t, err)
	require.Equal(t, "u1", claims["sub"])
	require.Equal(t, 2, fetches)
}

func TestValidate_KeepsServingStaleKeysWhenRefetchFails(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	fetches := 0
	v := &JWKSValidator{
		issuer: "iss",
		ttl:    time.Nanosecond,
		fetch: func() (jose.JSONWebKeySet, error) {
			fetches++
			if fetches == 1 {
				return publicSet("k", key), nil
			}
			return jose.JSONWebKeySet{}, errors.New("jwks unreachable")
		},
	}

	claims, err := v.Validate(sign(t, key, "k", futureClaims()))
	require.NoError(t, err)
	require.Equal(t, "u1", claims["sub"])

	claims, err = v.Validate(sign(t, key, "k", futureClaims()))
	require.NoError(t, err)
	require.Equal(t, "u1", claims["sub"])
	require.Equal(t, 2, fetches)
}

func TestValidate_KeepsServingStaleKeysWhenRefetchReturnsEmptySet(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	fetches := 0
	v := &JWKSValidator{
		issuer: "iss",
		ttl:    time.Nanosecond,
		fetch: func() (jose.JSONWebKeySet, error) {
			fetches++
			if fetches == 1 {
				return publicSet("k", key), nil
			}
			return jose.JSONWebKeySet{}, nil
		},
	}

	_, err = v.Validate(sign(t, key, "k", futureClaims()))
	require.NoError(t, err)

	claims, err := v.Validate(sign(t, key, "k", futureClaims()))
	require.NoError(t, err)
	require.Equal(t, "u1", claims["sub"])
}

func TestValidate_EmptyKeySetOnColdStartIsUnavailable(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	v := &JWKSValidator{
		issuer:   "iss",
		coldWait: time.Hour,
		fetch: func() (jose.JSONWebKeySet, error) {
			return jose.JSONWebKeySet{}, nil
		},
	}

	_, err = v.Validate(sign(t, key, "k", futureClaims()))
	require.ErrorIs(t, err, ErrKeysUnavailable)
}

func TestValidate_RejectsMissingSubject(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	base := func() map[string]any {
		return map[string]any{"iss": "iss", "exp": float64(time.Now().Add(time.Hour).Unix())}
	}

	cases := map[string]any{"missing": nil, "empty": "", "non-string": 42}
	for name, sub := range cases {
		t.Run(name, func(t *testing.T) {
			claims := base()
			if sub != nil {
				claims["sub"] = sub
			}
			_, verr := v.Validate(sign(t, key, "k", claims))
			require.ErrorIs(t, verr, ErrInvalidToken)
		})
	}
}

func TestValidate_CacheHitIsNotBlockedByInFlightFetch(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	release := make(chan struct{})
	entered := make(chan struct{})
	v := &JWKSValidator{
		issuer:      "iss",
		ttl:         time.Hour,
		keys:        publicSet("k", key),
		loaded:      true,
		attemptedAt: time.Now(),
		fetch: func() (jose.JSONWebKeySet, error) {
			close(entered)
			<-release
			return publicSet("k", key), nil
		},
	}
	known := sign(t, key, "k", futureClaims())
	unknown := sign(t, key, "rotated", futureClaims())

	blocked := make(chan struct{})
	go func() {
		defer close(blocked)
		_, _ = v.Validate(unknown)
	}()
	<-entered

	done := make(chan error, 1)
	go func() {
		_, verr := v.Validate(known)
		done <- verr
	}()

	select {
	case verr := <-done:
		require.NoError(t, verr)
	case <-time.After(2 * time.Second):
		t.Fatal("cache hit blocked by in-flight jwks fetch")
	}

	close(release)
	<-blocked
}

func TestValidate_ConcurrentUnknownKidSharesOneFetch(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	var mu sync.Mutex
	fetches := 0
	gate := make(chan struct{})
	v := &JWKSValidator{
		issuer:   "iss",
		ttl:      time.Hour,
		cooldown: time.Hour,
		coldWait: time.Hour,
		fetch: func() (jose.JSONWebKeySet, error) {
			mu.Lock()
			fetches++
			mu.Unlock()
			<-gate
			return publicSet("k", key), nil
		},
	}
	token := sign(t, key, "k", futureClaims())

	const workers = 16
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, verr := v.Validate(token)
			errs <- verr
		}()
	}

	time.Sleep(100 * time.Millisecond)
	close(gate)
	wg.Wait()
	close(errs)

	for verr := range errs {
		require.NoError(t, verr)
	}

	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, 1, fetches)
}

func TestNewJWKSValidatorFromURL_Defaults(t *testing.T) {
	v := NewJWKSValidatorFromURL("http://keycloak/certs", "iss")
	require.Equal(t, defaultJWKSTTL, v.ttl)
	require.Equal(t, defaultJWKSCooldown, v.cooldown)
	require.Equal(t, defaultJWKSColdWait, v.coldWait)
	require.Positive(t, v.coldWait)
	require.Less(t, v.coldWait, v.cooldown)
}

func TestValidate_RejectsKeyWithMismatchedAlgorithm(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	keys := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
		{Key: key.Public(), KeyID: "k", Algorithm: string(jose.ES256), Use: "sig"},
	}}
	v := NewJWKSValidatorFromKeySet(keys, "iss")

	_, err = v.Validate(sign(t, key, "k", futureClaims()))
	require.ErrorIs(t, err, ErrUnknownKey)
}

func TestValidate_NotBeforeLeeway(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	v := NewJWKSValidatorFromKeySet(publicSet("k", key), "iss")

	within := futureClaims()
	within["nbf"] = float64(time.Now().Add(10 * time.Second).Unix())
	_, err = v.Validate(sign(t, key, "k", within))
	require.NoError(t, err)

	beyond := futureClaims()
	beyond["nbf"] = float64(time.Now().Add(2 * time.Minute).Unix())
	_, err = v.Validate(sign(t, key, "k", beyond))
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestFetchJWKS_ShippedClientHasTimeout(t *testing.T) {
	require.Equal(t, jwksFetchTimeout, jwksHTTPClient.Timeout)
	require.Positive(t, jwksHTTPClient.Timeout)
}

func TestFetchJWKS_HonoursClientTimeout(t *testing.T) {
	blocked := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-blocked:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		close(blocked)
		srv.Close()
	})

	previous := jwksHTTPClient
	jwksHTTPClient = &http.Client{Timeout: 50 * time.Millisecond}
	t.Cleanup(func() { jwksHTTPClient = previous })

	start := time.Now()
	_, err := fetchJWKS(srv.URL)
	require.Error(t, err)
	require.Less(t, time.Since(start), time.Second)
}

func validJWKSBody(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	body, err := json.Marshal(publicSet("k", key))
	require.NoError(t, err)
	return string(body)
}

func paddedJWKSBody(t *testing.T, key *rsa.PrivateKey, pad int) string {
	t.Helper()
	return fmt.Sprintf(`{"pad":%q,%s`, strings.Repeat("a", pad), validJWKSBody(t, key)[1:])
}

func jwksServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestFetchJWKS_AcceptsValidResponse(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	srv := jwksServer(t, http.StatusOK, validJWKSBody(t, key))
	v := NewJWKSValidatorFromURL(srv.URL, "iss")

	claims, err := v.Validate(sign(t, key, "k", futureClaims()))
	require.NoError(t, err)
	require.Equal(t, "u1", claims["sub"])
}

func TestFetchJWKS_RejectsNonOKStatus(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	body := validJWKSBody(t, key)

	keys, err := fetchJWKS(jwksServer(t, http.StatusOK, body).URL)
	require.NoError(t, err)
	require.Len(t, keys.Keys, 1)

	for name, status := range map[string]int{
		"server error": http.StatusInternalServerError,
		"not found":    http.StatusNotFound,
		"unauthorized": http.StatusUnauthorized,
	} {
		t.Run(name, func(t *testing.T) {
			_, ferr := fetchJWKS(jwksServer(t, status, body).URL)
			require.Error(t, ferr)
		})
	}
}

func TestFetchJWKS_RejectsUnusableBody(t *testing.T) {
	for name, body := range map[string]string{
		"empty key set": `{"keys":[]}`,
		"not json":      `<html>nope</html>`,
		"truncated":     `{"keys":[`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := fetchJWKS(jwksServer(t, http.StatusOK, body).URL)
			require.Error(t, err)
		})
	}
}

func TestFetchJWKS_LimitsResponseBody(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	within := paddedJWKSBody(t, key, jwksMaxBodyBytes/2)
	require.Less(t, len(within), jwksMaxBodyBytes)

	keys, err := fetchJWKS(jwksServer(t, http.StatusOK, within).URL)
	require.NoError(t, err)
	require.Len(t, keys.Keys, 1)

	beyond := paddedJWKSBody(t, key, jwksMaxBodyBytes+4096)
	require.Greater(t, len(beyond), jwksMaxBodyBytes)

	_, err = fetchJWKS(jwksServer(t, http.StatusOK, beyond).URL)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "empty key set")
}

func TestValidate_ConcurrentValidationIsRaceFree(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	v := &JWKSValidator{
		issuer: "iss",
		ttl:    time.Nanosecond,
		fetch: func() (jose.JSONWebKeySet, error) {
			return publicSet("k", key), nil
		},
	}
	token := sign(t, key, "k", futureClaims())

	const workers = 32
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, verr := v.Validate(token)
			errs <- verr
		}()
	}
	wg.Wait()
	close(errs)

	for verr := range errs {
		require.NoError(t, verr)
	}
}
