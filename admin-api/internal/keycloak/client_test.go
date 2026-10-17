package keycloak

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

const tokenPath = "/realms/corporate/protocol/openid-connect/token"

func fakeKeycloakCounting(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var tokenCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == tokenPath {
			tokenCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"access_token":"t%d","expires_in":60}`, tokenCalls.Load())
			return
		}
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, &tokenCalls
}

func fakeKeycloak(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv, _ := fakeKeycloakCounting(t, handler)
	return srv
}

func TestCreateUser(t *testing.T) {
	var body map[string]any
	var srv *httptest.Server
	srv = fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/admin/realms/corporate/users", r.URL.Path)
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		w.Header().Set("Location", srv.URL+"/admin/realms/corporate/users/sub-123")
		w.WriteHeader(http.StatusCreated)
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	sub, err := c.CreateUser(context.Background(), "emp-1", Profile{Email: "a@example.com", FirstName: "Анна", LastName: "Ли", Enabled: true}, "Tmp-pass-1")
	require.NoError(t, err)
	require.Equal(t, "sub-123", sub)
	require.Equal(t, "a@example.com", body["username"])
	require.Equal(t, []any{"emp-1"}, body["attributes"].(map[string]any)["employeeId"])
	cred := body["credentials"].([]any)[0].(map[string]any)
	require.Equal(t, true, cred["temporary"])
}

func TestCreateUser_Conflict(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	_, err := c.CreateUser(context.Background(), "emp-1", Profile{Email: "a@example.com"}, "x")
	require.ErrorIs(t, err, domain.ErrEmailTaken)
}

func TestUpdateUser_PreservesAttributes(t *testing.T) {
	var put map[string]any
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/admin/realms/corporate/users/sub-1", r.URL.Path)
		switch r.Method {
		case http.MethodGet:
			_, _ = w.Write([]byte(`{"id":"sub-1","username":"old@example.com","email":"old@example.com","firstName":"Старое","lastName":"Имя","enabled":true,"attributes":{"employeeId":["emp-1"]}}`))
		case http.MethodPut:
			require.NoError(t, json.NewDecoder(r.Body).Decode(&put))
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	require.NoError(t, c.UpdateUser(context.Background(), "sub-1", Profile{Email: "new@example.com", FirstName: "Новое", LastName: "Имя", Enabled: false}))
	require.Equal(t, []any{"emp-1"}, put["attributes"].(map[string]any)["employeeId"])
	require.Equal(t, "new@example.com", put["email"])
	require.Equal(t, "Новое", put["firstName"])
	require.Equal(t, false, put["enabled"])
	require.Equal(t, "old@example.com", put["username"])
}

func TestErrors(t *testing.T) {
	cases := []struct {
		name    string
		handler http.HandlerFunc
		want    error
	}{
		{"500", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }, domain.ErrIdPUnavailable},
		{"400", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(400) }, domain.ErrIdPRejected},
		{"404", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) }, domain.ErrIdPAccountMissing},
		{"403", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(403) }, domain.ErrIdPUnavailable},
		{"обрыв соединения", func(w http.ResponseWriter, _ *http.Request) {
			conn, _, err := w.(http.Hijacker).Hijack()
			require.NoError(t, err)
			_ = conn.Close()
		}, domain.ErrIdPUnavailable},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := fakeKeycloak(t, c.handler)
			kc := New(srv.URL, "corporate", "admin-api", "secret")
			_, err := kc.GetUser(context.Background(), "sub-1")
			require.ErrorIs(t, err, c.want)
		})
	}
}

func TestDeleteUser_NotFoundIsNotError(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodDelete, r.Method)
		w.WriteHeader(http.StatusNotFound)
	})
	kc := New(srv.URL, "corporate", "admin-api", "secret")
	require.NoError(t, kc.DeleteUser(context.Background(), "sub-1"))
}

func TestPasswordAndLogout(t *testing.T) {
	var calls []string
	var body map[string]any
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Method == http.MethodPut {
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		}
		w.WriteHeader(http.StatusNoContent)
	})
	kc := New(srv.URL, "corporate", "admin-api", "secret")
	require.NoError(t, kc.SetPassword(context.Background(), "sub-1", "Tmp-2"))
	require.NoError(t, kc.Logout(context.Background(), "sub-1"))
	require.Equal(t, []string{
		"PUT /admin/realms/corporate/users/sub-1/reset-password",
		"POST /admin/realms/corporate/users/sub-1/logout",
	}, calls)
	require.Equal(t, "password", body["type"])
	require.Equal(t, "Tmp-2", body["value"])
	require.Equal(t, true, body["temporary"])
}

func TestGetUser(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/admin/realms/corporate/users/sub-1":
			_, _ = w.Write([]byte(`{"id":"sub-1","username":"a@example.com","email":"a@example.com","firstName":"Анна","lastName":"Ли","enabled":true,"attributes":{"employeeId":["emp-1"]}}`))
		case "/admin/realms/corporate/users/sub-1/groups":
			_, _ = w.Write([]byte(`[{"name":"managers"},{"name":"staff"}]`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	})
	kc := New(srv.URL, "corporate", "admin-api", "secret")
	u, err := kc.GetUser(context.Background(), "sub-1")
	require.NoError(t, err)
	require.Equal(t, User{ID: "sub-1", Username: "a@example.com", Email: "a@example.com", FirstName: "Анна", LastName: "Ли", Enabled: true, EmployeeID: "emp-1", Groups: []string{"managers", "staff"}}, u)
}

func TestTokenCachedAndRefreshedOn401(t *testing.T) {
	var userCalls atomic.Int32
	srv, tokenCalls := fakeKeycloakCounting(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin/realms/corporate/users/sub-1/groups" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		if userCalls.Add(1) == 3 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"id":"sub-1"}`))
	})
	kc := New(srv.URL, "corporate", "admin-api", "secret")
	_, err := kc.GetUser(context.Background(), "sub-1")
	require.NoError(t, err)
	_, err = kc.GetUser(context.Background(), "sub-1")
	require.NoError(t, err)
	require.EqualValues(t, 1, tokenCalls.Load())
	_, err = kc.GetUser(context.Background(), "sub-1")
	require.NoError(t, err)
	require.EqualValues(t, 2, tokenCalls.Load())
	require.EqualValues(t, 4, userCalls.Load())
}

func TestTokenSource(t *testing.T) {
	srv, calls := fakeKeycloakCounting(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) })
	ts := NewTokenSource(TokenEndpoint(srv.URL+"/", "corporate"), "admin-api-notify", "secret", srv.Client())
	tok, err := ts.Token(context.Background())
	require.NoError(t, err)
	require.Equal(t, "t1", tok)
	tok, err = ts.Token(context.Background())
	require.NoError(t, err)
	require.Equal(t, "t1", tok)
	ts.Invalidate("t1")
	tok, err = ts.Token(context.Background())
	require.NoError(t, err)
	require.Equal(t, "t2", tok)
	require.EqualValues(t, 2, calls.Load())
}

func TestListUsers_Paginates(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/realms/corporate/users" {
			_, _ = w.Write([]byte(`[{"name":"staff"}]`))
			return
		}
		first, _ := strconv.Atoi(r.URL.Query().Get("first"))
		require.Equal(t, "100", r.URL.Query().Get("max"))
		var page []map[string]any
		for i := first; i < 103 && i < first+100; i++ {
			page = append(page, map[string]any{"id": fmt.Sprintf("sub-%d", i), "username": fmt.Sprintf("u%d@example.com", i), "enabled": true})
		}
		require.NoError(t, json.NewEncoder(w).Encode(page))
	})
	kc := New(srv.URL, "corporate", "admin-api", "secret")
	users, err := kc.ListUsers(context.Background())
	require.NoError(t, err)
	require.Len(t, users, 103)
	require.Equal(t, []string{"staff"}, users[0].Groups)
	require.Equal(t, "u102@example.com", users[102].Username)
}

func TestAccountMissingOnExistingRowOperations(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) })
	kc := New(srv.URL, "corporate", "admin-api", "secret")
	ctx := context.Background()
	require.ErrorIs(t, kc.UpdateUser(ctx, "sub-1", Profile{Email: "a@example.com"}), domain.ErrIdPAccountMissing)
	require.ErrorIs(t, kc.SetPassword(ctx, "sub-1", "x"), domain.ErrIdPAccountMissing)
	require.ErrorIs(t, kc.Logout(ctx, "sub-1"), domain.ErrIdPAccountMissing)
	_, err := kc.GetProfile(ctx, "sub-1")
	require.ErrorIs(t, err, domain.ErrIdPAccountMissing)
	require.NotErrorIs(t, err, domain.ErrNotFound)
}

func TestCreateUser_EmptyLocationFindsByExactEmail(t *testing.T) {
	var lookup string
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			w.WriteHeader(http.StatusCreated)
		case http.MethodGet:
			lookup = r.URL.RawQuery
			_, _ = w.Write([]byte(`[{"id":"other","email":"ab@example.com"},{"id":"sub-9","email":"A@Example.com"}]`))
		}
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	sub, err := c.CreateUser(context.Background(), "emp-1", Profile{Email: "a@example.com", Enabled: true}, "x")
	require.NoError(t, err)
	require.Equal(t, "sub-9", sub)
	require.Contains(t, lookup, "exact=true")
	require.Contains(t, lookup, "email=a%40example.com")
}

func TestCreateUser_EmptyLocationRetriesLookupOnce(t *testing.T) {
	var gets atomic.Int32
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			w.WriteHeader(http.StatusCreated)
		case http.MethodGet:
			if gets.Add(1) == 1 {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			_, _ = w.Write([]byte(`[{"id":"sub-7","email":"a@example.com"}]`))
		}
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	sub, err := c.CreateUser(context.Background(), "emp-1", Profile{Email: "a@example.com", Enabled: true}, "x")
	require.NoError(t, err)
	require.Equal(t, "sub-7", sub)
	require.EqualValues(t, 2, gets.Load())
}

func TestCreateUser_EmptyLocationNotFoundIsUnavailable(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
			return
		}
		_, _ = w.Write([]byte(`[]`))
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	_, err := c.CreateUser(context.Background(), "emp-1", Profile{Email: "a@example.com"}, "x")
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
}

func TestGetProfile_SkipsGroups(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/admin/realms/corporate/users/sub-1", r.URL.Path)
		_, _ = w.Write([]byte(`{"id":"sub-1","username":"a@example.com","email":"a@example.com","firstName":"Анна","lastName":"Ли","enabled":true,"attributes":{"employeeId":["emp-1"]}}`))
	})
	kc := New(srv.URL, "corporate", "admin-api", "secret")
	u, err := kc.GetProfile(context.Background(), "sub-1")
	require.NoError(t, err)
	require.Equal(t, User{ID: "sub-1", Username: "a@example.com", Email: "a@example.com", FirstName: "Анна", LastName: "Ли", Enabled: true, EmployeeID: "emp-1"}, u)
}
