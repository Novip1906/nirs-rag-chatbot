package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func insertDepartment(t *testing.T, s *Store, name string) (domain.Department, error) {
	t.Helper()
	ctx := context.Background()
	var out domain.Department
	err := s.InTx(ctx, func(tx *Tx) error {
		var err error
		out, err = tx.InsertDepartment(ctx, domain.Department{ID: uuid.New(), Name: name})
		return err
	})
	return out, err
}

func TestDepartments_DuplicateNameCaseInsensitive(t *testing.T) {
	s := testStore(t)
	_, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)
	_, err = insertDepartment(t, s, "продажи")
	require.ErrorIs(t, err, domain.ErrDepartmentNameTaken)
}

func TestDepartments_NameFreedAfterDelete(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	d, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteDepartment(ctx, d.ID) }))
	_, err = insertDepartment(t, s, "Продажи")
	require.NoError(t, err)
	list, err := s.ListDepartments(ctx)
	require.NoError(t, err)
	require.Len(t, list, 1)
	changed, err := s.DepartmentsChangedSince(ctx, d.CreatedAt, true)
	require.NoError(t, err)
	require.Len(t, changed, 2)
	changed, err = s.DepartmentsChangedSince(ctx, d.CreatedAt, false)
	require.NoError(t, err)
	require.Len(t, changed, 1)
}

func TestDepartments_EmployeesCount(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	d, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)
	mustEmployee(t, s, "a@example.com", func(e *domain.Employee) { e.DepartmentID = &d.ID })
	gone := mustEmployee(t, s, "b@example.com", func(e *domain.Employee) { e.DepartmentID = &d.ID })
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteEmployee(ctx, gone.ID) }))
	list, err := s.ListDepartments(ctx)
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, 1, list[0].EmployeesCount)
	one, err := s.DepartmentByID(ctx, d.ID)
	require.NoError(t, err)
	require.Equal(t, 1, one.EmployeesCount)
}

func TestDepartments_CountMembers(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	d, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)
	mustEmployee(t, s, "a@example.com", func(e *domain.Employee) { e.DepartmentID = &d.ID })
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		n, err := tx.CountDepartmentMembers(ctx, d.ID)
		require.Equal(t, 1, n)
		return err
	}))
}

func TestDepartments_LockSave(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	d, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		locked, err := tx.LockDepartment(ctx, d.ID)
		require.NoError(t, err)
		locked.Description = "описание"
		saved, err := tx.SaveDepartment(ctx, locked)
		require.NoError(t, err)
		require.Equal(t, "описание", saved.Description)
		return nil
	}))
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteDepartment(ctx, d.ID) }))
	err = s.InTx(ctx, func(tx *Tx) error {
		_, err := tx.LockDepartment(ctx, d.ID)
		return err
	})
	require.ErrorIs(t, err, domain.ErrNotFound)
	_, err = s.DepartmentByID(ctx, d.ID)
	require.ErrorIs(t, err, domain.ErrNotFound)
}
