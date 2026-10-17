package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
)

type Validator interface {
	Validate(token string) (map[string]any, error)
}

type Principal struct {
	Sub     string
	Client  string
	Service bool
}

type principalKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}

type Middleware struct {
	Validator     Validator
	Audience      string
	ReaderClients []string
	AdminClients  []string
}

func (m *Middleware) RequireUser(next http.Handler) http.Handler {
	return m.require(next, false)
}

func (m *Middleware) RequireReader(next http.Handler) http.Handler {
	return m.require(next, true)
}

func (m *Middleware) require(next http.Handler, service bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := m.authenticate(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		if p.Service != service {
			writeError(w, http.StatusForbidden, "forbidden", "access denied")
			return
		}
		if !service && !slices.Contains(m.AdminClients, p.Client) {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}

func (m *Middleware) authenticate(r *http.Request) (Principal, bool) {
	header := r.Header.Get("Authorization")
	scheme, token, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
		return Principal{}, false
	}
	claims, err := m.Validator.Validate(strings.TrimSpace(token))
	if err != nil {
		return Principal{}, false
	}
	if !hasAudience(claims["aud"], m.Audience) {
		return Principal{}, false
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return Principal{}, false
	}
	azp, _ := claims["azp"].(string)
	sid, _ := claims["sid"].(string)
	service := azp != "" && sid == "" && slices.Contains(m.ReaderClients, azp)
	return Principal{Sub: sub, Client: azp, Service: service}, true
}

func hasAudience(aud any, want string) bool {
	switch v := aud.(type) {
	case string:
		return v == want
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s == want {
				return true
			}
		}
	case []string:
		return slices.Contains(v, want)
	}
	return false
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error_code": code, "message": message})
}
