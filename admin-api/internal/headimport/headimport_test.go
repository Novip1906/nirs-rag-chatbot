package headimport

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func insertDepartment(t *testing.T, s *store.Store, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	require.NoError(t, s.InTx(context.Background(), func(tx *store.Tx) error {
		_, err := tx.InsertDepartment(context.Background(), domain.Department{ID: id, Name: name})
		return err
	}))
	return id
}

func insertEmployee(t *testing.T, s *store.Store, mut func(*domain.Employee)) domain.Employee {
	t.Helper()
	now := time.Now()
	e := domain.Employee{ID: uuid.New(), FirstName: "Тест", ActivatedAt: &now}
	e.Sub, e.Email = "sub-"+e.ID.String(), e.ID.String()+"@example.com"
	if mut != nil {
		mut(&e)
	}
	var out domain.Employee
	require.NoError(t, s.InTx(context.Background(), func(tx *store.Tx) error {
		var err error
		out, err = tx.InsertEmployee(context.Background(), e)
		return err
	}))
	return out
}

func TestRun_DryRunThenApply(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	dep := insertDepartment(t, s, "Продажи")
	withDep := insertEmployee(t, s, func(e *domain.Employee) { e.DepartmentID = &dep })
	noDep := insertEmployee(t, s, nil)
	already := insertEmployee(t, s, func(e *domain.Employee) { e.DepartmentID, e.IsHead = &dep, true })
	entries := []Entry{{withDep.ID.String()}, {noDep.ID.String()}, {already.ID.String()}, {uuid.NewString()}, {"не-uuid"}}

	report, err := Run(ctx, s, entries, false)
	require.NoError(t, err)
	require.Equal(t, []string{withDep.ID.String()}, report.Set)
	require.Equal(t, []string{noDep.ID.String()}, report.NoDepartment)
	require.Equal(t, []string{already.ID.String()}, report.AlreadySet)
	require.Len(t, report.NotFound, 2)
	got, _ := s.EmployeeByID(ctx, withDep.ID)
	require.False(t, got.IsHead)

	_, err = Run(ctx, s, entries, true)
	require.NoError(t, err)
	got, _ = s.EmployeeByID(ctx, withDep.ID)
	require.True(t, got.IsHead)
	require.True(t, got.UpdatedAt.After(withDep.UpdatedAt))
	_, total, err := s.ListAudit(ctx, store.AuditFilter{TargetType: domain.TargetEmployee, TargetID: &withDep.ID})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	got, _ = s.EmployeeByID(ctx, noDep.ID)
	require.False(t, got.IsHead)

	report, err = Run(ctx, s, entries, true)
	require.NoError(t, err)
	require.Empty(t, report.Set)
	require.ElementsMatch(t, []string{already.ID.String(), withDep.ID.String()}, report.AlreadySet)
	_, total, err = s.ListAudit(ctx, store.AuditFilter{TargetType: domain.TargetEmployee, TargetID: &withDep.ID})
	require.NoError(t, err)
	require.Equal(t, 1, total)
}

func TestRun_DeletedAndDuplicates(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	dep := insertDepartment(t, s, "Продажи")
	gone := insertEmployee(t, s, func(e *domain.Employee) { e.DepartmentID = &dep })
	require.NoError(t, s.InTx(ctx, func(tx *store.Tx) error { return tx.SoftDeleteEmployee(ctx, gone.ID) }))
	twice := insertEmployee(t, s, func(e *domain.Employee) { e.DepartmentID = &dep })

	report, err := Run(ctx, s, []Entry{{gone.ID.String()}, {twice.ID.String()}, {twice.ID.String()}}, true)
	require.NoError(t, err)
	require.Equal(t, []string{gone.ID.String()}, report.NotFound)
	require.Equal(t, []string{twice.ID.String()}, report.Set)
}
