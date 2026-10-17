package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func TestAudit_NewestFirstAndPaged(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	actor := mustEmployee(t, s, "actor@example.com", nil)
	target, other := uuid.New(), uuid.New()
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		for i, action := range []string{"employee.invite", "employee.update", "employee.delete"} {
			if err := tx.InsertAudit(ctx, &actor.ID, action, domain.TargetEmployee, target, map[string]any{"n": i}); err != nil {
				return err
			}
		}
		if err := tx.InsertAudit(ctx, nil, "department.create", domain.TargetDepartment, other, nil); err != nil {
			return err
		}
		return nil
	}))

	items, total, err := s.ListAudit(ctx, AuditFilter{TargetType: domain.TargetEmployee, TargetID: &target, Limit: 2})
	require.NoError(t, err)
	require.Equal(t, 3, total)
	require.Len(t, items, 2)
	require.Equal(t, "employee.delete", items[0].Action)
	require.Equal(t, "employee.update", items[1].Action)
	require.Equal(t, actor.ID, *items[0].ActorID)
	require.Equal(t, "Имя", items[0].ActorFirstName)
	require.Equal(t, float64(2), items[0].Details["n"])

	items, total, err = s.ListAudit(ctx, AuditFilter{TargetType: domain.TargetEmployee, TargetID: &target, Limit: 2, Offset: 2})
	require.NoError(t, err)
	require.Equal(t, 3, total)
	require.Len(t, items, 1)
	require.Equal(t, "employee.invite", items[0].Action)

	items, total, err = s.ListAudit(ctx, AuditFilter{Limit: 10})
	require.NoError(t, err)
	require.Equal(t, 4, total)
	require.Equal(t, "department.create", items[0].Action)
	require.Nil(t, items[0].ActorID)
	require.Equal(t, "", items[0].ActorFirstName)
	require.Empty(t, items[0].Details)
}
