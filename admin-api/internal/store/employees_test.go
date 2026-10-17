package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func TestEmployees_EmailFreedAfterDelete(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	first := mustEmployee(t, s, "a@example.com", nil)
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteEmployee(ctx, first.ID) }))
	second := mustEmployee(t, s, "a@example.com", func(e *domain.Employee) { e.Sub = "sub-other" })
	require.NotEqual(t, first.ID, second.ID)
}

func TestEmployees_DuplicateEmail(t *testing.T) {
	s := testStore(t)
	mustEmployee(t, s, "a@example.com", nil)
	err := s.InTx(context.Background(), func(tx *Tx) error {
		_, err := tx.InsertEmployee(context.Background(), domain.Employee{ID: uuid.New(), Sub: "x", Email: "a@example.com", FirstName: "И", LastName: "Ф"})
		return err
	})
	require.ErrorIs(t, err, domain.ErrEmailTaken)
}

func TestEmployees_UpdatedSinceInclusive(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	e := mustEmployee(t, s, "a@example.com", nil)
	got, err := s.EmployeesChangedSince(ctx, e.UpdatedAt, false)
	require.NoError(t, err)
	require.Len(t, got, 1)
	got, err = s.EmployeesChangedSince(ctx, e.UpdatedAt.Add(time.Microsecond), false)
	require.NoError(t, err)
	require.Empty(t, got)
}

func TestEmployees_ChangedSinceDeleted(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	e := mustEmployee(t, s, "a@example.com", nil)
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteEmployee(ctx, e.ID) }))
	hidden, _ := s.EmployeesChangedSince(ctx, time.Time{}, false)
	require.Empty(t, hidden)
	shown, _ := s.EmployeesChangedSince(ctx, time.Time{}, true)
	require.Len(t, shown, 1)
	require.NotNil(t, shown[0].DeletedAt)
	require.True(t, !shown[0].UpdatedAt.Before(*shown[0].DeletedAt))
}

func TestEmployees_ListFilters(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	var dep domain.Department
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		var err error
		dep, err = tx.InsertDepartment(ctx, domain.Department{ID: uuid.New(), Name: "Продажи"})
		return err
	}))
	mustEmployee(t, s, "in@example.com", func(e *domain.Employee) { e.DepartmentID = &dep.ID; e.Position = "Менеджер" })
	mustEmployee(t, s, "out@example.com", func(e *domain.Employee) { e.Blocked = true })
	items, total, err := s.ListEmployees(ctx, EmployeeFilter{DepartmentID: &dep.ID, Limit: 50})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "in@example.com", items[0].Email)
	_, total, _ = s.ListEmployees(ctx, EmployeeFilter{NoDepartment: true, Limit: 50})
	require.Equal(t, 1, total)
	_, total, _ = s.ListEmployees(ctx, EmployeeFilter{Status: "blocked", Limit: 50})
	require.Equal(t, 1, total)
	_, total, _ = s.ListEmployees(ctx, EmployeeFilter{Query: "менедж", Limit: 50})
	require.Equal(t, 1, total)
}

func TestEmployees_NewColumnsRoundTrip(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	inviter := mustEmployee(t, s, "inviter@example.com", nil)
	now := time.Now().UTC().Truncate(time.Microsecond)
	expires := now.Add(7 * 24 * time.Hour)
	e := mustEmployee(t, s, "a@example.com", func(e *domain.Employee) {
		e.IsHead = true
		e.InvitedAt = &now
		e.InviteExpiresAt = &expires
		e.InvitedBy = &inviter.ID
		e.ActivatedAt = &now
		e.NameConfirmedAt = &now
	})
	got, err := s.EmployeeByID(ctx, e.ID)
	require.NoError(t, err)
	require.True(t, got.IsHead)
	require.True(t, now.Equal(*got.InvitedAt))
	require.True(t, expires.Equal(*got.InviteExpiresAt))
	require.Equal(t, inviter.ID, *got.InvitedBy)
	require.True(t, now.Equal(*got.ActivatedAt))
	require.True(t, now.Equal(*got.NameConfirmedAt))
	require.Nil(t, got.AvatarVersion)
}

func TestEmployees_StatusFilter(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := time.Now()
	insert := func(email string, activated *time.Time, blocked bool) {
		require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
			_, err := tx.InsertEmployee(ctx, domain.Employee{ID: uuid.New(), Sub: "sub-" + email, Email: email, FirstName: "Т", ActivatedAt: activated, Blocked: blocked})
			return err
		}))
	}
	insert("active@example.com", &now, false)
	insert("invited@example.com", nil, false)
	insert("blocked@example.com", &now, true)
	for status, want := range map[string]string{"active": "active@example.com", "invited": "invited@example.com", "blocked": "blocked@example.com"} {
		items, total, err := s.ListEmployees(ctx, EmployeeFilter{Status: status})
		require.NoError(t, err)
		require.Equal(t, 1, total, status)
		require.Equal(t, want, items[0].Email)
	}
}

func TestEmployees_CountActiveAdmins(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := time.Now()
	mustEmployee(t, s, "a@example.com", func(e *domain.Employee) { e.IsAdmin = true; e.ActivatedAt = &now })
	mustEmployee(t, s, "b@example.com", func(e *domain.Employee) { e.IsAdmin = true; e.Blocked = true; e.ActivatedAt = &now })
	mustEmployee(t, s, "c@example.com", func(e *domain.Employee) { e.IsAdmin = true })
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		n, err := tx.CountActiveAdmins(ctx)
		require.Equal(t, 1, n)
		return err
	}))
}

func TestEmployees_LockSaveAndLookups(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	e := mustEmployee(t, s, "a@example.com", nil)
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		locked, err := tx.LockEmployee(ctx, e.ID)
		require.NoError(t, err)
		locked.Position = "Директор"
		saved, err := tx.SaveEmployee(ctx, locked)
		require.NoError(t, err)
		require.Equal(t, "Директор", saved.Position)
		require.False(t, saved.UpdatedAt.Before(e.UpdatedAt))
		return nil
	}))
	byID, err := s.EmployeeByID(ctx, e.ID)
	require.NoError(t, err)
	require.Equal(t, "Директор", byID.Position)
	bySub, err := s.EmployeeBySub(ctx, e.Sub)
	require.NoError(t, err)
	require.Equal(t, e.ID, bySub.ID)
	active, err := s.ActiveEmployees(ctx)
	require.NoError(t, err)
	require.Len(t, active, 1)

	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteEmployee(ctx, e.ID) }))
	err = s.InTx(ctx, func(tx *Tx) error {
		_, err := tx.LockEmployee(ctx, e.ID)
		return err
	})
	require.ErrorIs(t, err, domain.ErrNotFound)
	_, err = s.EmployeeByID(ctx, e.ID)
	require.NoError(t, err)
	_, err = s.EmployeeByID(ctx, uuid.New())
	require.ErrorIs(t, err, domain.ErrNotFound)
	active, err = s.ActiveEmployees(ctx)
	require.NoError(t, err)
	require.Empty(t, active)
}

func TestEmailTaken(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	taken, err := s.EmailTaken(ctx, "a@example.com")
	require.NoError(t, err)
	require.False(t, taken)
	e := mustEmployee(t, s, "a@example.com", nil)
	taken, err = s.EmailTaken(ctx, "a@example.com")
	require.NoError(t, err)
	require.True(t, taken)
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteEmployee(ctx, e.ID) }))
	taken, err = s.EmailTaken(ctx, "a@example.com")
	require.NoError(t, err)
	require.False(t, taken)
}
