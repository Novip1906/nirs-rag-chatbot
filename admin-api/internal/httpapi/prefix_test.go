package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWithPathPrefix(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(r.URL.Path)) })
	get := func(h http.Handler, path string) string {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec.Body.String()
	}

	prefixed := WithPathPrefix("/api", inner)
	require.Equal(t, "/health", get(prefixed, "/api/health"))
	require.Equal(t, "/admin/v1/me", get(prefixed, "/api/admin/v1/me"))
	require.Equal(t, "/v1/employees", get(prefixed, "/v1/employees"))

	plain := WithPathPrefix("", inner)
	require.Equal(t, "/health", get(plain, "/health"))
}
