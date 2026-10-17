package keycloak

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func TestCreateInvited_NoCredentials(t *testing.T) {
	var body map[string]any
	var srv *httptest.Server
	srv = fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/admin/realms/corporate/users", r.URL.Path)
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		w.Header().Set("Location", srv.URL+"/admin/realms/corporate/users/sub-9")
		w.WriteHeader(http.StatusCreated)
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	sub, err := c.CreateInvited(context.Background(), "emp-1", Profile{Email: "a@example.com", FirstName: "Анна", LastName: "Ли", Enabled: true})
	require.NoError(t, err)
	require.Equal(t, "sub-9", sub)
	require.NotContains(t, body, "credentials")
	require.Equal(t, []any{"UPDATE_PASSWORD"}, body["requiredActions"])
	require.Equal(t, true, body["emailVerified"])
	require.Equal(t, []any{"emp-1"}, body["attributes"].(map[string]any)["employeeId"])
}

func TestCreateInvited_Conflict(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusConflict) })
	c := New(srv.URL, "corporate", "admin-api", "secret")
	_, err := c.CreateInvited(context.Background(), "emp-1", Profile{Email: "a@example.com"})
	require.ErrorIs(t, err, domain.ErrEmailTaken)
}

func TestMagicLink_RequestAndUserMismatch(t *testing.T) {
	var body map[string]any
	userID := "sub-1"
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/realms/corporate/magic-link", r.URL.Path)
		require.Equal(t, http.MethodPost, r.Method)
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		_, _ = w.Write([]byte(`{"user_id":"` + userID + `","link":"https://auth.test/l","sent":true}`))
	})
	c := New(srv.URL, "corporate", "admin-api", "secret").WithInvite("chat", "https://chat.test/")

	link, err := c.MagicLink(context.Background(), "sub-1", "a@example.com", 7*24*time.Hour)
	require.NoError(t, err)
	require.Equal(t, InviteLink{Link: "https://auth.test/l", Sent: true}, link)
	require.Equal(t, "a@example.com", body["email"])
	require.Equal(t, "chat", body["client_id"])
	require.Equal(t, "https://chat.test/", body["redirect_uri"])
	require.Equal(t, float64(604800), body["expiration_seconds"])
	require.Equal(t, false, body["reusable"])
	require.Equal(t, false, body["force_create"])
	require.Equal(t, true, body["send_email"])

	userID = "someone-else"
	_, err = c.MagicLink(context.Background(), "sub-1", "a@example.com", time.Hour)
	require.ErrorIs(t, err, domain.ErrIdPRejected)
}

func TestMagicLink_EmptyLinkRejected(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"user_id":"sub-1","link":"","sent":false}`))
	})
	c := New(srv.URL, "corporate", "admin-api", "secret").WithInvite("chat", "https://chat.test/")
	_, err := c.MagicLink(context.Background(), "sub-1", "a@example.com", time.Hour)
	require.ErrorIs(t, err, domain.ErrIdPRejected)
}

func TestHasPassword(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/admin/realms/corporate/users/with/credentials":
			_, _ = w.Write([]byte(`[{"type":"otp"},{"type":"password"}]`))
		case "/admin/realms/corporate/users/without/credentials":
			_, _ = w.Write([]byte(`[]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	has, err := c.HasPassword(context.Background(), "with")
	require.NoError(t, err)
	require.True(t, has)
	has, err = c.HasPassword(context.Background(), "without")
	require.NoError(t, err)
	require.False(t, has)
	_, err = c.HasPassword(context.Background(), "gone")
	require.ErrorIs(t, err, domain.ErrIdPAccountMissing)
}

func TestFindByEmail(t *testing.T) {
	srv := fakeKeycloak(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/admin/realms/corporate/users", r.URL.Path)
		if r.URL.Query().Get("email") == "a@example.com" {
			_, _ = w.Write([]byte(`[{"id":"sub-1","email":"a@example.com","attributes":{"employeeId":["emp-1"]}}]`))
			return
		}
		_, _ = w.Write([]byte(`[]`))
	})
	c := New(srv.URL, "corporate", "admin-api", "secret")
	u, found, err := c.FindByEmail(context.Background(), "a@example.com")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "sub-1", u.ID)
	require.Equal(t, "emp-1", u.EmployeeID)
	_, found, err = c.FindByEmail(context.Background(), "none@example.com")
	require.NoError(t, err)
	require.False(t, found)
}
