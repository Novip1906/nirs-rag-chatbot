package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func setBase(t *testing.T) {
	t.Helper()
	for k, v := range map[string]string{
		"POSTGRES_DSN":                 "postgres://x",
		"KEYCLOAK_ISSUER":              "https://sso.example.com/realms/corporate",
		"KEYCLOAK_JWKS_URL":            "http://keycloak/jwks",
		"KEYCLOAK_ADMIN_URL":           "http://keycloak",
		"KEYCLOAK_REALM":               "corporate",
		"KEYCLOAK_ADMIN_CLIENT_SECRET": "s",
		"PUBLIC_BASE_URL":              "https://admin.test/api/",
		"INVITE_CLIENT_ID":             "chat",
		"INVITE_REDIRECT_URL":          "https://chat.test/",
	} {
		t.Setenv(k, v)
	}
	for _, k := range []string{"NOTIFY_URLS", "NOTIFY_CLIENT_ID", "NOTIFY_CLIENT_SECRET", "ADMIN_CLIENTS", "RECONCILE_INTERVAL", "RECONCILE_MAX_DISABLES", "RECONCILE_MAX_ENABLES", "INVITE_TTL", "ACTIVATION_INTERVAL"} {
		t.Setenv(k, "")
	}
}

func TestLoad_Defaults(t *testing.T) {
	setBase(t)
	c, err := Load()
	require.NoError(t, err)
	require.Equal(t, []string{"admin"}, c.AdminClients)
	require.Equal(t, "admin-api-notify", c.NotifyClientID)
}

func TestLoad_AdminClients(t *testing.T) {
	setBase(t)
	t.Setenv("ADMIN_CLIENTS", "admin, chat-ui")
	c, err := Load()
	require.NoError(t, err)
	require.Equal(t, []string{"admin", "chat-ui"}, c.AdminClients)
	t.Setenv("ADMIN_CLIENTS", " , ")
	_, err = Load()
	require.Error(t, err)
}

func TestLoad_NotifyRequiresSecret(t *testing.T) {
	setBase(t)
	t.Setenv("NOTIFY_URLS", "http://ai/notify")
	_, err := Load()
	require.ErrorContains(t, err, "NOTIFY_CLIENT_SECRET")
	t.Setenv("NOTIFY_CLIENT_SECRET", "n")
	c, err := Load()
	require.NoError(t, err)
	require.Equal(t, "n", c.NotifyClientSecret)
}

func TestLoad_ReconcileBounds(t *testing.T) {
	cases := []struct {
		interval, maxDisables string
		ok                    bool
	}{
		{"", "", true},
		{"0", "0", true},
		{"1m", "10", true},
		{"59s", "5", false},
		{"1ms", "5", false},
		{"-1m", "5", false},
		{"5m", "-1", false},
		{"5m", "x", false},
	}
	for _, c := range cases {
		t.Run(c.interval+"/"+c.maxDisables, func(t *testing.T) {
			setBase(t)
			t.Setenv("RECONCILE_INTERVAL", c.interval)
			t.Setenv("RECONCILE_MAX_DISABLES", c.maxDisables)
			_, err := Load()
			if c.ok {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestLoad_PublicBaseURL(t *testing.T) {
	setBase(t)
	c, err := Load()
	require.NoError(t, err)
	require.Equal(t, "https://admin.test/api", c.PublicBaseURL)
	t.Setenv("PUBLIC_BASE_URL", "")
	_, err = Load()
	require.ErrorContains(t, err, "PUBLIC_BASE_URL")
}

func TestLoad_InviteSettings(t *testing.T) {
	setBase(t)
	c, err := Load()
	require.NoError(t, err)
	require.Equal(t, "chat", c.InviteClientID)
	require.Equal(t, "https://chat.test/", c.InviteRedirectURL)
	require.Equal(t, 168*time.Hour, c.InviteTTL)
	require.Equal(t, 30*time.Second, c.ActivationInterval)

	t.Setenv("INVITE_TTL", "24h")
	t.Setenv("ACTIVATION_INTERVAL", "10s")
	c, err = Load()
	require.NoError(t, err)
	require.Equal(t, 24*time.Hour, c.InviteTTL)
	require.Equal(t, 10*time.Second, c.ActivationInterval)

	t.Setenv("INVITE_TTL", "0s")
	_, err = Load()
	require.ErrorContains(t, err, "INVITE_TTL")
	t.Setenv("INVITE_TTL", "24h")
	t.Setenv("ACTIVATION_INTERVAL", "0s")
	_, err = Load()
	require.ErrorContains(t, err, "ACTIVATION_INTERVAL")
	t.Setenv("ACTIVATION_INTERVAL", "30s")

	t.Setenv("INVITE_CLIENT_ID", "")
	_, err = Load()
	require.ErrorContains(t, err, "INVITE_CLIENT_ID")
}

func TestLoad_ReconcileMaxEnables(t *testing.T) {
	setBase(t)
	c, err := Load()
	require.NoError(t, err)
	require.Equal(t, 5, c.ReconcileMaxEnables)
	t.Setenv("RECONCILE_MAX_ENABLES", "2")
	c, err = Load()
	require.NoError(t, err)
	require.Equal(t, 2, c.ReconcileMaxEnables)
	t.Setenv("RECONCILE_MAX_ENABLES", "-1")
	_, err = Load()
	require.ErrorContains(t, err, "RECONCILE_MAX_ENABLES")
	t.Setenv("RECONCILE_MAX_ENABLES", "x")
	_, err = Load()
	require.ErrorContains(t, err, "RECONCILE_MAX_ENABLES")
}
