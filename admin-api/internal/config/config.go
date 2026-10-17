package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr             string
	HTTPPathPrefix       string
	PublicBaseURL        string
	PostgresDSN          string
	Issuer               string
	JWKSURL              string
	Audience             string
	ReaderClients        []string
	AdminClients         []string
	KeycloakAdminURL     string
	KeycloakRealm        string
	KeycloakClientID     string
	KeycloakSecret       string
	NotifyClientID       string
	NotifyClientSecret   string
	NotifyURLs           []string
	ReconcileInterval    time.Duration
	ReconcileMaxDisables int
	ReconcileMaxEnables  int
	InviteClientID       string
	InviteRedirectURL    string
	InviteTTL            time.Duration
	ActivationInterval   time.Duration
}

func LoadDatabase() (*Config, error) {
	c := &Config{PostgresDSN: os.Getenv("POSTGRES_DSN")}
	if c.PostgresDSN == "" {
		return nil, fmt.Errorf("missing required environment variables: POSTGRES_DSN")
	}
	return c, nil
}

func LoadImport() (*Config, error) {
	c := &Config{
		PostgresDSN:      os.Getenv("POSTGRES_DSN"),
		KeycloakAdminURL: os.Getenv("KEYCLOAK_ADMIN_URL"),
		KeycloakRealm:    os.Getenv("KEYCLOAK_REALM"),
		KeycloakClientID: get("KEYCLOAK_ADMIN_CLIENT_ID", "admin-api"),
		KeycloakSecret:   os.Getenv("KEYCLOAK_ADMIN_CLIENT_SECRET"),
	}
	var missing []string
	for _, r := range []struct{ name, value string }{
		{"POSTGRES_DSN", c.PostgresDSN},
		{"KEYCLOAK_ADMIN_URL", c.KeycloakAdminURL},
		{"KEYCLOAK_REALM", c.KeycloakRealm},
		{"KEYCLOAK_ADMIN_CLIENT_SECRET", c.KeycloakSecret},
	} {
		if r.value == "" {
			missing = append(missing, r.name)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return c, nil
}

func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:         get("HTTP_ADDR", ":8091"),
		HTTPPathPrefix:   strings.TrimRight(get("HTTP_PATH_PREFIX", ""), "/"),
		PublicBaseURL:    strings.TrimRight(os.Getenv("PUBLIC_BASE_URL"), "/"),
		PostgresDSN:      os.Getenv("POSTGRES_DSN"),
		Issuer:           os.Getenv("KEYCLOAK_ISSUER"),
		JWKSURL:          os.Getenv("KEYCLOAK_JWKS_URL"),
		Audience:         get("KEYCLOAK_AUDIENCE", "admin-api"),
		ReaderClients:    list(os.Getenv("READER_CLIENTS")),
		AdminClients:     list(get("ADMIN_CLIENTS", "admin")),
		KeycloakAdminURL: os.Getenv("KEYCLOAK_ADMIN_URL"),
		KeycloakRealm:    os.Getenv("KEYCLOAK_REALM"),
		KeycloakClientID: get("KEYCLOAK_ADMIN_CLIENT_ID", "admin-api"),
		KeycloakSecret:   os.Getenv("KEYCLOAK_ADMIN_CLIENT_SECRET"),
		NotifyURLs:       list(os.Getenv("NOTIFY_URLS")),

		InviteClientID:    os.Getenv("INVITE_CLIENT_ID"),
		InviteRedirectURL: os.Getenv("INVITE_REDIRECT_URL"),

		NotifyClientID:     get("NOTIFY_CLIENT_ID", "admin-api-notify"),
		NotifyClientSecret: os.Getenv("NOTIFY_CLIENT_SECRET"),
	}

	var missing []string
	for _, r := range []struct{ name, value string }{
		{"POSTGRES_DSN", c.PostgresDSN},
		{"KEYCLOAK_ISSUER", c.Issuer},
		{"KEYCLOAK_JWKS_URL", c.JWKSURL},
		{"KEYCLOAK_ADMIN_URL", c.KeycloakAdminURL},
		{"KEYCLOAK_REALM", c.KeycloakRealm},
		{"KEYCLOAK_ADMIN_CLIENT_SECRET", c.KeycloakSecret},
		{"PUBLIC_BASE_URL", c.PublicBaseURL},
		{"INVITE_CLIENT_ID", c.InviteClientID},
		{"INVITE_REDIRECT_URL", c.InviteRedirectURL},
	} {
		if r.value == "" {
			missing = append(missing, r.name)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	if len(c.AdminClients) == 0 {
		return nil, fmt.Errorf("ADMIN_CLIENTS: пустой список")
	}
	if len(c.NotifyURLs) > 0 && c.NotifyClientSecret == "" {
		return nil, fmt.Errorf("NOTIFY_CLIENT_SECRET: обязательна, если задан NOTIFY_URLS")
	}

	interval, err := time.ParseDuration(get("RECONCILE_INTERVAL", "5m"))
	if err != nil {
		return nil, fmt.Errorf("RECONCILE_INTERVAL: %w", err)
	}
	if interval != 0 && interval < time.Minute {
		return nil, fmt.Errorf("RECONCILE_INTERVAL: должен быть 0 или не меньше 1m")
	}
	c.ReconcileInterval = interval

	maxDisables, err := strconv.Atoi(get("RECONCILE_MAX_DISABLES", "5"))
	if err != nil {
		return nil, fmt.Errorf("RECONCILE_MAX_DISABLES: %w", err)
	}
	if maxDisables < 0 {
		return nil, fmt.Errorf("RECONCILE_MAX_DISABLES: не может быть меньше 0")
	}
	c.ReconcileMaxDisables = maxDisables

	maxEnables, err := strconv.Atoi(get("RECONCILE_MAX_ENABLES", "5"))
	if err != nil {
		return nil, fmt.Errorf("RECONCILE_MAX_ENABLES: %w", err)
	}
	if maxEnables < 0 {
		return nil, fmt.Errorf("RECONCILE_MAX_ENABLES: не может быть меньше 0")
	}
	c.ReconcileMaxEnables = maxEnables

	if c.InviteTTL, err = time.ParseDuration(get("INVITE_TTL", "168h")); err != nil {
		return nil, fmt.Errorf("INVITE_TTL: %w", err)
	}
	if c.InviteTTL < time.Minute {
		return nil, fmt.Errorf("INVITE_TTL: должен быть не меньше 1m")
	}
	if c.ActivationInterval, err = time.ParseDuration(get("ACTIVATION_INTERVAL", "30s")); err != nil {
		return nil, fmt.Errorf("ACTIVATION_INTERVAL: %w", err)
	}
	if c.ActivationInterval < time.Second {
		return nil, fmt.Errorf("ACTIVATION_INTERVAL: должен быть не меньше 1s")
	}
	return c, nil
}

func get(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func list(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
