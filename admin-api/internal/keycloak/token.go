package keycloak

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

const tokenExpiryMargin = 30 * time.Second

func TokenEndpoint(adminURL, realm string) string {
	return fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", strings.TrimRight(adminURL, "/"), url.PathEscape(realm))
}

func NewTokenSource(tokenURL, clientID, secret string, client *http.Client) *TokenSource {
	return &TokenSource{url: tokenURL, clientID: clientID, secret: secret, http: client}
}

type TokenSource struct {
	url      string
	clientID string
	secret   string
	http     *http.Client

	mu      sync.Mutex
	token   string
	expires time.Time
}

func (s *TokenSource) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && time.Now().Before(s.expires) {
		return s.token, nil
	}
	token, expires, err := s.fetch(ctx)
	if err != nil {
		return "", err
	}
	s.token = token
	s.expires = expires
	return token, nil
}

func (s *TokenSource) Invalidate(failed string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token == failed {
		s.token = ""
		s.expires = time.Time{}
	}
}

func (s *TokenSource) fetch(ctx context.Context) (string, time.Time, error) {
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {s.clientID},
		"client_secret": {s.secret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, strings.NewReader(form.Encode()))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("%w: %v", domain.ErrIdPUnavailable, err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.http.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("%w: %v", domain.ErrIdPUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", time.Time{}, fmt.Errorf("%w: token endpoint status %d", domain.ErrIdPUnavailable, resp.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body.AccessToken == "" {
		return "", time.Time{}, fmt.Errorf("%w: invalid token response", domain.ErrIdPUnavailable)
	}
	ttl := time.Duration(body.ExpiresIn)*time.Second - tokenExpiryMargin
	return body.AccessToken, time.Now().Add(ttl), nil
}
