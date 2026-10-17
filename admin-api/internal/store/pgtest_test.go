package store

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

var (
	pgOnce sync.Once
	pgDSN  string
	pgErr  error
)

func testStore(t *testing.T) *Store {
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
	s, err := Open(pgDSN)
	require.NoError(t, err)
	require.NoError(t, s.Migrate(context.Background()))
	_, err = s.db.Exec(`TRUNCATE employees, departments, employee_avatars, audit_log`)
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func mustEmployee(t *testing.T, s *Store, email string, mut func(*domain.Employee)) domain.Employee {
	t.Helper()
	e := domain.Employee{ID: uuid.New(), Sub: "sub-" + email, Email: email, FirstName: "Имя", LastName: "Фамилия"}
	if mut != nil {
		mut(&e)
	}
	var out domain.Employee
	require.NoError(t, s.InTx(context.Background(), func(tx *Tx) error {
		var err error
		out, err = tx.InsertEmployee(context.Background(), e)
		return err
	}))
	return out
}
