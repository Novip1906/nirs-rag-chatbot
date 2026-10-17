package service

import (
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGeneratePassword(t *testing.T) {
	re := regexp.MustCompile(`^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$`)
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		p := GeneratePassword()
		require.Regexp(t, re, p)
		require.True(t, strings.ContainsAny(p, "0123456789"), p)
		require.True(t, strings.ContainsAny(p, "abcdefghijklmnopqrstuvwxyz"), p)
		require.True(t, strings.ContainsAny(p, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"), p)
		seen[p] = true
	}
	require.Len(t, seen, 100)
}
