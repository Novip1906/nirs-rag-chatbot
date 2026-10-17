package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

type stubValidator struct {
	claims map[string]any
	err    error
}

func (s stubValidator) Validate(string) (map[string]any, error) { return s.claims, s.err }

func serve(h http.Handler, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func newMiddleware(claims map[string]any) *Middleware {
	return &Middleware{
		Validator:     stubValidator{claims: claims},
		Audience:      "admin-api",
		ReaderClients: []string{"ai-admin-api"},
		AdminClients:  []string{"admin"},
	}
}

func TestRequireUser(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := PrincipalFrom(r.Context())
		_, _ = w.Write([]byte(p.Sub))
	})
	cases := []struct {
		name   string
		token  string
		claims map[string]any
		err    error
		status int
	}{
		{"нет заголовка", "", nil, nil, 401},
		{"плохая подпись", "t", nil, ErrInvalidToken, 401},
		{"чужая аудитория", "t", map[string]any{"sub": "u1", "aud": "other", "azp": "admin"}, nil, 401},
		{"аудитория в другом регистре", "t", map[string]any{"sub": "u1", "aud": "Admin-API", "azp": "admin"}, nil, 401},
		{"аудитория строкой", "t", map[string]any{"sub": "u1", "aud": "admin-api", "azp": "admin"}, nil, 200},
		{"аудитория списком", "t", map[string]any{"sub": "u1", "aud": []any{"account", "admin-api"}, "azp": "admin"}, nil, 200},
		{"аудитория массивом строк", "t", map[string]any{"sub": "u1", "aud": []string{"account", "admin-api"}, "azp": "admin"}, nil, 200},
		{"токен без azp", "t", map[string]any{"sub": "u1", "aud": "admin-api"}, nil, 401},
		{"пустой sub", "t", map[string]any{"sub": "", "aud": "admin-api", "azp": "admin"}, nil, 401},
		{"нет sub", "t", map[string]any{"aud": "admin-api", "azp": "admin"}, nil, 401},
		{"чужой azp у человека", "t", map[string]any{"sub": "u1", "aud": "admin-api", "azp": "other-ui", "sid": "s"}, nil, 401},
		{"вход человека через клиента-читателя", "t", map[string]any{"sub": "u1", "aud": "admin-api", "azp": "ai-admin-api", "sid": "s"}, nil, 401},
		{"сервисный токен на пользовательском маршруте", "t", map[string]any{"sub": "svc", "aud": "admin-api", "azp": "ai-admin-api"}, nil, 403},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := newMiddleware(c.claims)
			m.Validator = stubValidator{c.claims, c.err}
			rec := serve(m.RequireUser(ok), c.token)
			require.Equal(t, c.status, rec.Code)
		})
	}
}

func TestRequireReader(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	cases := []struct {
		name   string
		claims map[string]any
		status int
	}{
		{"сервисный токен", map[string]any{"sub": "svc", "aud": "admin-api", "azp": "ai-admin-api"}, 200},
		{"человек", map[string]any{"sub": "u1", "aud": "admin-api", "azp": "admin", "sid": "s"}, 403},
		{"читатель с sid", map[string]any{"sub": "u1", "aud": "admin-api", "azp": "ai-admin-api", "sid": "s"}, 403},
		{"читатель с пустым sid", map[string]any{"sub": "svc", "aud": "admin-api", "azp": "ai-admin-api", "sid": ""}, 200},
		{"без azp", map[string]any{"sub": "svc", "aud": "admin-api"}, 403},
		{"чужой клиент без sid", map[string]any{"sub": "svc", "aud": "admin-api", "azp": "other"}, 403},
		{"пустой sub", map[string]any{"sub": "", "aud": "admin-api", "azp": "ai-admin-api"}, 401},
		{"чужая аудитория", map[string]any{"sub": "svc", "aud": "admin-API", "azp": "ai-admin-api"}, 401},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			require.Equal(t, c.status, serve(newMiddleware(c.claims).RequireReader(ok), "t").Code)
		})
	}
}
