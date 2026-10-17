package service

import (
	"bytes"
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func TestLastAdmin_ConcurrentCrossBlockLeavesOneAdmin(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	a := seedAdmin(t, s)
	b := seedAdmin(t, s)
	idp.delay = 300 * time.Millisecond

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, errs[0] = s.UpdateEmployee(ctx, a, b.ID, EmployeeInput{Blocked: ptr(true)})
	}()
	go func() {
		defer wg.Done()
		_, errs[1] = s.UpdateEmployee(ctx, b, a.ID, EmployeeInput{Blocked: ptr(true)})
	}()
	wg.Wait()

	failed := 0
	for _, err := range errs {
		if err != nil {
			require.ErrorIs(t, err, domain.ErrLastAdmin)
			failed++
		}
	}
	require.Equal(t, 1, failed)
	var active int
	require.NoError(t, s.Store.InTx(ctx, func(tx *store.Tx) error {
		var err error
		active, err = tx.CountActiveAdmins(ctx)
		return err
	}))
	require.Equal(t, 1, active)
}

func TestLastAdmin_ConcurrentCrossDelete(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	a := seedAdmin(t, s)
	b := seedAdmin(t, s)
	idp.delay = 300 * time.Millisecond

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, errs[0] = s.UpdateEmployee(ctx, a, b.ID, EmployeeInput{Blocked: ptr(true)})
	}()
	go func() {
		defer wg.Done()
		errs[1] = s.DeleteEmployee(ctx, b, a.ID, false)
	}()
	wg.Wait()

	failed := 0
	for _, err := range errs {
		if err != nil {
			require.ErrorIs(t, err, domain.ErrLastAdmin)
			failed++
		}
	}
	require.Equal(t, 1, failed)
}

func TestDepartmentRace_AssignVersusDelete(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	for i := 0; i < 15; i++ {
		d, err := s.CreateDepartment(ctx, admin, DepartmentInput{Name: ptr("Отдел " + uuid.NewString())})
		require.NoError(t, err)
		e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr(uuid.NewString() + "@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})

		var wg sync.WaitGroup
		var assignErr, deleteErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, assignErr = s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{DepartmentID: ptr(&d.ID)})
		}()
		go func() {
			defer wg.Done()
			deleteErr = s.DeleteDepartment(ctx, admin, d.ID)
		}()
		wg.Wait()

		if assignErr == nil {
			require.ErrorIs(t, deleteErr, domain.ErrDepartmentNotEmpty)
		} else {
			var v *domain.ValidationError
			require.ErrorAs(t, assignErr, &v)
			require.Equal(t, "unknown", v.Fields["department_id"])
			require.NoError(t, deleteErr)
		}
		got, err := s.Store.EmployeeByID(ctx, e.ID)
		require.NoError(t, err)
		if got.DepartmentID != nil {
			_, err := s.Store.DepartmentByID(ctx, *got.DepartmentID)
			require.NoError(t, err)
		}
	}
}

func TestCreateEmployee_CompensatesOnDetachedContext(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seedAdmin(t, s)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	idp.onCreate = func() {
		_ = s.Store.InTx(context.Background(), func(tx *store.Tx) error {
			_, err := tx.InsertEmployee(context.Background(), domain.Employee{ID: uuid.New(), Sub: "other", Email: "a@example.com", FirstName: "Х", LastName: "У"})
			return err
		})
		cancel()
	}
	_, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	require.ErrorIs(t, err, domain.ErrEmailTaken)
	require.Len(t, idp.calls, 2)
	require.Equal(t, "create", idp.calls[0])
	require.Contains(t, idp.calls[1], "delete:sub-")
	require.NoError(t, idp.deleteCtxErr)
}

func TestCreateEmployee_CompensationFailureLoggedAsError(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seedAdmin(t, s)
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)
	idp.onCreate = func() {
		_ = s.Store.InTx(context.Background(), func(tx *store.Tx) error {
			_, err := tx.InsertEmployee(context.Background(), domain.Employee{ID: uuid.New(), Sub: "other", Email: "a@example.com", FirstName: "Х", LastName: "У"})
			return err
		})
	}
	idp.deleteErr = domain.ErrIdPUnavailable
	_, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	require.ErrorIs(t, err, domain.ErrEmailTaken)
	out := buf.String()
	require.Contains(t, out, "level=ERROR")
	require.Contains(t, out, "sub=sub-")
	require.Contains(t, out, "email=a@example.com")
}

func TestUpdateEmployee_SurvivesCancelledRequestContext(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seedAdmin(t, s)
	e := createEmployee(context.Background(), t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	ctx, cancel := context.WithCancel(context.Background())
	idp.onCreate = nil
	cancel()
	got, err := s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{LastName: ptr("Новая")})
	require.NoError(t, err)
	require.Equal(t, "Новая", got.LastName)
	require.NoError(t, idp.updateCtxErr)
}

func TestDeleteAndResetPassword_SurviveCancelledRequestContext(t *testing.T) {
	s, _, _ := newService(t)
	admin := seedAdmin(t, s)
	e := seed(t, s, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := s.ResetPassword(ctx, admin, e.ID)
	require.NoError(t, err)
	require.NoError(t, s.DeleteEmployee(ctx, admin, e.ID, false))
}

func TestUpdateEmployee_NoChangeIsNoop(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	d, _ := s.CreateDepartment(ctx, admin, DepartmentInput{Name: ptr("Продажи")})
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б"), Position: ptr("Юрист"), DepartmentID: ptr(&d.ID)})
	idp.calls, n.employees = nil, nil
	before, err := s.Store.EmployeeByID(ctx, e.ID)
	require.NoError(t, err)

	inputs := []EmployeeInput{
		{},
		{Position: ptr("Юрист"), LastName: ptr("Б")},
		{Email: ptr("A@Example.com"), DepartmentID: ptr(&d.ID), Blocked: ptr(false), IsAdmin: ptr(false)},
	}
	for _, in := range inputs {
		got, err := s.UpdateEmployee(ctx, admin, e.ID, in)
		require.NoError(t, err)
		require.Equal(t, before, got)
	}
	after, err := s.Store.EmployeeByID(ctx, e.ID)
	require.NoError(t, err)
	require.Equal(t, before.UpdatedAt, after.UpdatedAt)
	require.Empty(t, idp.calls)
	require.Empty(t, n.employees)
}

func TestUpdateEmployee_AccountMissingRollsBack(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	e := seed(t, s, func(e *domain.Employee) { e.LastName = "Б" })
	n.employees = nil
	idp.err = domain.ErrIdPAccountMissing
	_, err := s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{LastName: ptr("Новая")})
	require.ErrorIs(t, err, domain.ErrIdPAccountMissing)
	require.NotErrorIs(t, err, domain.ErrNotFound)
	got, _ := s.Store.EmployeeByID(ctx, e.ID)
	require.Equal(t, "Б", got.LastName)
	_, err = s.ResetPassword(ctx, admin, e.ID)
	require.ErrorIs(t, err, domain.ErrIdPAccountMissing)
	require.Empty(t, n.employees)
}

func TestDeleteEmployee_MissingAccountStillSucceeds(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	idp.err = nil
	require.NoError(t, s.DeleteEmployee(ctx, admin, e.ID, false))
}
