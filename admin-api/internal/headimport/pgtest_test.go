package headimport

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

var (
	pgOnce sync.Once
	pgDSN  string
	pgErr  error
)

func testStore(t *testing.T) *store.Store {
	t.Helper()
	pgOnce.Do(func() {
		ctx := context.Background()
		c, err := postgres.Run(ctx, "postgres:16.15-alpine3.24",
			postgres.WithDatabase("admin_api"), postgres.WithUsername("postgres"), postgres.WithPassword("postgres"),
			testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(90*time.Second)))
		if err != nil {
			pgErr = err
			return
		}
		pgDSN, pgErr = c.ConnectionString(ctx, "sslmode=disable")
	})
	require.NoError(t, pgErr)
	s, err := store.Open(pgDSN)
	require.NoError(t, err)
	require.NoError(t, s.Migrate(context.Background()))
	require.NoError(t, s.TruncateForTests(context.Background()))
	t.Cleanup(func() { _ = s.Close() })
	return s
}
