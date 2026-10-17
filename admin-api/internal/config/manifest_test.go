package config

import (
	"os"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

func manifest(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile("../../" + path)
	require.NoError(t, err)
	return string(raw)
}

func TestBaseManifest_MemoryAndClients(t *testing.T) {
	base := manifest(t, "deploy/20-admin-api.yaml")
	require.Regexp(t, regexp.MustCompile(`limits:\s+memory: "384Mi"`), base)
	require.Regexp(t, regexp.MustCompile(`- name: GOMEMLIMIT\s+value: "300MiB"`), base)
	require.Contains(t, base, `ADMIN_CLIENTS: "admin"`)
}
