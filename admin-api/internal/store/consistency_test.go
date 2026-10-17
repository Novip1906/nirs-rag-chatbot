package store

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func TestTimestamps_UseStatementClock(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	e := mustEmployee(t, s, "a@example.com", nil)
	d, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)

	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		var txStart time.Time
		require.NoError(t, tx.tx.QueryRowContext(ctx, `SELECT now()`).Scan(&txStart))
		time.Sleep(150 * time.Millisecond)

		locked, err := tx.LockEmployee(ctx, e.ID)
		require.NoError(t, err)
		saved, err := tx.SaveEmployee(ctx, locked)
		require.NoError(t, err)
		require.True(t, saved.UpdatedAt.After(txStart.Add(100*time.Millisecond)))

		savedDep, err := tx.SaveDepartment(ctx, d)
		require.NoError(t, err)
		require.True(t, savedDep.UpdatedAt.After(txStart.Add(100*time.Millisecond)))

		inserted, err := tx.InsertEmployee(ctx, domain.Employee{ID: uuid.New(), Sub: "sub-b", Email: "b@example.com", FirstName: "Б", LastName: "В"})
		require.NoError(t, err)
		require.True(t, inserted.CreatedAt.After(txStart.Add(100*time.Millisecond)))
		require.Equal(t, inserted.CreatedAt, inserted.UpdatedAt)

		insertedDep, err := tx.InsertDepartment(ctx, domain.Department{ID: uuid.New(), Name: "Юристы"})
		require.NoError(t, err)
		require.True(t, insertedDep.CreatedAt.After(txStart.Add(100*time.Millisecond)))
		require.Equal(t, insertedDep.CreatedAt, insertedDep.UpdatedAt)
		return nil
	}))

	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		var txStart time.Time
		require.NoError(t, tx.tx.QueryRowContext(ctx, `SELECT now()`).Scan(&txStart))
		time.Sleep(150 * time.Millisecond)
		require.NoError(t, tx.SoftDeleteEmployee(ctx, e.ID))
		require.NoError(t, tx.SoftDeleteDepartment(ctx, d.ID))
		return nil
	}))
	got, err := s.EmployeeByID(ctx, e.ID)
	require.NoError(t, err)
	require.NotNil(t, got.DeletedAt)
	require.Equal(t, *got.DeletedAt, got.UpdatedAt)
	gotDep, err := s.DepartmentsChangedSince(ctx, time.Unix(0, 0), true)
	require.NoError(t, err)
	for _, dep := range gotDep {
		if dep.ID == d.ID {
			require.NotNil(t, dep.DeletedAt)
			require.Equal(t, *dep.DeletedAt, dep.UpdatedAt)
		}
	}
}

func TestLockAdmins_Serializes(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	locked := make(chan struct{})
	release := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = s.InTx(ctx, func(tx *Tx) error {
			require.NoError(t, tx.LockAdmins(ctx))
			close(locked)
			<-release
			return nil
		})
	}()
	<-locked

	acquired := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = s.InTx(ctx, func(tx *Tx) error {
			require.NoError(t, tx.LockAdmins(ctx))
			close(acquired)
			return nil
		})
	}()
	select {
	case <-acquired:
		t.Fatal("вторая транзакция получила блокировку, пока первая её держит")
	case <-time.After(300 * time.Millisecond):
	}
	close(release)
	select {
	case <-acquired:
	case <-time.After(5 * time.Second):
		t.Fatal("блокировка не снялась после коммита")
	}
	wg.Wait()
}

func TestDepartmentForShare_BlocksDeleteUntilCommit(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	d, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)
	e := mustEmployee(t, s, "a@example.com", nil)

	shared := make(chan struct{})
	release := make(chan struct{})
	assignDone := make(chan error, 1)
	go func() {
		assignDone <- s.InTx(ctx, func(tx *Tx) error {
			if err := tx.DepartmentForShare(ctx, d.ID); err != nil {
				return err
			}
			close(shared)
			<-release
			locked, err := tx.LockEmployee(ctx, e.ID)
			if err != nil {
				return err
			}
			locked.DepartmentID = &d.ID
			_, err = tx.SaveEmployee(ctx, locked)
			return err
		})
	}()
	<-shared

	deleteResult := make(chan error, 1)
	go func() {
		deleteResult <- s.InTx(ctx, func(tx *Tx) error {
			if _, err := tx.LockDepartment(ctx, d.ID); err != nil {
				return err
			}
			n, err := tx.CountDepartmentMembers(ctx, d.ID)
			if err != nil {
				return err
			}
			if n > 0 {
				return domain.ErrDepartmentNotEmpty
			}
			return tx.SoftDeleteDepartment(ctx, d.ID)
		})
	}()
	select {
	case err := <-deleteResult:
		t.Fatalf("удаление отдела не дождалось назначения: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	close(release)
	require.NoError(t, <-assignDone)
	require.ErrorIs(t, <-deleteResult, domain.ErrDepartmentNotEmpty)
}

func TestDepartmentForShare_DeletedDepartmentNotFound(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	d, err := insertDepartment(t, s, "Продажи")
	require.NoError(t, err)

	locked := make(chan struct{})
	release := make(chan struct{})
	deleteDone := make(chan error, 1)
	go func() {
		deleteDone <- s.InTx(ctx, func(tx *Tx) error {
			if _, err := tx.LockDepartment(ctx, d.ID); err != nil {
				return err
			}
			close(locked)
			<-release
			return tx.SoftDeleteDepartment(ctx, d.ID)
		})
	}()
	<-locked

	shareResult := make(chan error, 1)
	go func() {
		shareResult <- s.InTx(ctx, func(tx *Tx) error { return tx.DepartmentForShare(ctx, d.ID) })
	}()
	time.Sleep(200 * time.Millisecond)
	close(release)
	require.NoError(t, <-deleteDone)
	require.ErrorIs(t, <-shareResult, domain.ErrNotFound)
}
