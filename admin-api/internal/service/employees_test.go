package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func seed(t *testing.T, s *Service, mut func(*domain.Employee)) domain.Employee {
	t.Helper()
	now := time.Now()
	e := domain.Employee{ID: uuid.New(), Email: uuid.NewString() + "@example.com", FirstName: "Тест", ActivatedAt: &now}
	e.Sub = "sub-" + e.ID.String()
	if mut != nil {
		mut(&e)
	}
	var out domain.Employee
	require.NoError(t, s.Store.InTx(context.Background(), func(tx *store.Tx) error {
		var err error
		out, err = tx.InsertEmployee(context.Background(), e)
		return err
	}))
	return out
}

func seedAdmin(t *testing.T, s *Service) domain.Employee {
	t.Helper()
	return seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
}

func seedDepartment(t *testing.T, s *Service, admin domain.Employee, name string) uuid.UUID {
	t.Helper()
	d, err := s.CreateDepartment(context.Background(), admin, DepartmentInput{Name: ptr(name)})
	require.NoError(t, err)
	return d.ID
}

func TestCreateEmployee_EmailNormalized(t *testing.T) {
	s, idp, n := newService(t)
	admin := seedAdmin(t, s)
	ctx := context.Background()
	inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr(" Ivan@Example.COM "), FirstName: ptr(" Иван "), LastName: ptr("Ли")})
	require.NoError(t, err)
	e := inv.Employee
	require.Equal(t, "ivan@example.com", e.Email)
	require.Equal(t, "Иван", e.FirstName)
	require.Contains(t, e.Sub, e.ID.String())
	require.Equal(t, []string{"create"}, idp.calls)
	require.Equal(t, []uuid.UUID{e.ID}, n.employees)

	_, err = s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("IVAN@example.com"), FirstName: ptr("И"), LastName: ptr("Л")})
	require.ErrorIs(t, err, domain.ErrEmailTaken)
	require.Equal(t, []string{"create"}, idp.calls)
}

func TestCreateEmployee_Validation(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seedAdmin(t, s)
	_, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr("не-почта"), FirstName: ptr(""), LastName: ptr("Ли")})
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	require.Equal(t, "invalid", v.Fields["email"])
	require.Equal(t, "required", v.Fields["first_name"])
	require.Empty(t, idp.calls)
}

func TestCreateEmployee_UnknownDepartment(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seedAdmin(t, s)
	missing := uuid.New()
	_, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б"), DepartmentID: ptr(&missing)})
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	require.Equal(t, "unknown", v.Fields["department_id"])
	require.Empty(t, idp.calls)
}

func TestCreateEmployee_IdPFailureLeavesNoRow(t *testing.T) {
	s, idp, n := newService(t)
	admin := seedAdmin(t, s)
	idp.err = domain.ErrIdPUnavailable
	_, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
	_, total, _ := s.Store.ListEmployees(context.Background(), store.EmployeeFilter{Limit: 10})
	require.Equal(t, 1, total)
	require.Empty(t, n.employees)
}

func TestUpdateEmployee_IdPFailureRollsBack(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	n.employees = nil
	idp.err = domain.ErrIdPUnavailable
	_, err := s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{LastName: ptr("Новая"), Position: ptr("Юрист")})
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
	got, _ := s.Store.EmployeeByID(ctx, e.ID)
	require.Equal(t, "Б", got.LastName)
	require.Equal(t, "", got.Position)
	require.Empty(t, n.employees)
}

func TestUpdateEmployee_PositionOnlySkipsIdP(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	idp.calls = nil
	got, err := s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{Position: ptr("Юрист")})
	require.NoError(t, err)
	require.Equal(t, "Юрист", got.Position)
	require.Empty(t, idp.calls)
}

func TestUpdateEmployee_BlockDisablesAndLogsOut(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	idp.calls = nil
	_, err := s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{Blocked: ptr(true)})
	require.NoError(t, err)
	require.Equal(t, []string{"update:" + e.Sub + ":enabled=false", "logout:" + e.Sub}, idp.calls)
}

func TestUpdateEmployee_DepartmentAssignAndClear(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	d, _ := s.CreateDepartment(ctx, admin, DepartmentInput{Name: ptr("Продажи")})
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	got, err := s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{DepartmentID: ptr(&d.ID)})
	require.NoError(t, err)
	require.Equal(t, &d.ID, got.DepartmentID)
	got, err = s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{DepartmentID: ptr[*uuid.UUID](nil)})
	require.NoError(t, err)
	require.Nil(t, got.DepartmentID)
}

func TestUpdateEmployee_Guards(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	_, err := s.UpdateEmployee(ctx, admin, admin.ID, EmployeeInput{IsAdmin: ptr(false)})
	require.ErrorIs(t, err, domain.ErrSelfAdminRevoke)
	_, err = s.UpdateEmployee(ctx, admin, admin.ID, EmployeeInput{Blocked: ptr(true)})
	require.ErrorIs(t, err, domain.ErrSelfBlock)
	require.ErrorIs(t, s.DeleteEmployee(ctx, admin, admin.ID, false), domain.ErrSelfDelete)
}

func TestLastAdminGuard(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	only := seedAdmin(t, s)
	stale := seedAdmin(t, s)
	_, err := s.UpdateEmployee(ctx, only, stale.ID, EmployeeInput{Blocked: ptr(true)})
	require.NoError(t, err)
	_, err = s.UpdateEmployee(ctx, stale, only.ID, EmployeeInput{IsAdmin: ptr(false)})
	require.ErrorIs(t, err, domain.ErrLastAdmin)
	_, err = s.UpdateEmployee(ctx, stale, only.ID, EmployeeInput{Blocked: ptr(true)})
	require.ErrorIs(t, err, domain.ErrLastAdmin)
	require.ErrorIs(t, s.DeleteEmployee(ctx, stale, only.ID, false), domain.ErrLastAdmin)
}

func TestDeleteEmployee(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б")})
	idp.calls, n.employees = nil, nil
	require.NoError(t, s.DeleteEmployee(ctx, admin, e.ID, false))
	require.Equal(t, []string{"delete:" + e.Sub}, idp.calls)
	require.Equal(t, []uuid.UUID{e.ID}, n.employees)
	_, err := s.UpdateEmployee(ctx, admin, e.ID, EmployeeInput{Position: ptr("x")})
	require.ErrorIs(t, err, domain.ErrNotFound)
}

func TestResetPassword(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seedAdmin(t, s)
	ctx := context.Background()
	e := seed(t, s, nil)
	idp.calls = nil
	pwd, err := s.ResetPassword(ctx, admin, e.ID)
	require.NoError(t, err)
	require.Equal(t, "Tmp-pass-1", pwd)
	require.Equal(t, []string{"password", "logout:" + e.Sub}, idp.calls)
}

func TestCreateEmployee_EmailLength(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seedAdmin(t, s)
	local := strings.Repeat("a", 64)
	long := local + "@" + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 58) + ".com"
	require.Greater(t, len(long), 254)
	_, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr(long), FirstName: ptr("А"), LastName: ptr("Б")})
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	require.Equal(t, "invalid", v.Fields["email"])
	require.Empty(t, idp.calls)

	ok := local + "@" + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 50) + ".com"
	require.LessOrEqual(t, len(ok), 254)
	_, err = s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr(ok), FirstName: ptr("А"), LastName: ptr("Б")})
	require.NoError(t, err)
}

func TestCreateEmployee_LastNameOptional(t *testing.T) {
	s, _, _ := newService(t)
	admin := seedAdmin(t, s)
	inv, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr("mono@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)
	require.Equal(t, "", inv.Employee.LastName)
}

func TestUpdateEmployee_HeadMixedFieldsRejected(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	dep := seedDepartment(t, s, admin, "Продажи")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &dep })
	target := seed(t, s, func(e *domain.Employee) { e.DepartmentID, e.Position = &dep, "Менеджер" })

	_, err := s.UpdateEmployee(ctx, head, target.ID, EmployeeInput{Position: ptr("Старший менеджер"), IsAdmin: ptr(true)})
	require.ErrorIs(t, err, domain.ErrForbidden)
	got, err := s.Store.EmployeeByID(ctx, target.ID)
	require.NoError(t, err)
	require.Equal(t, "Менеджер", got.Position)
	require.False(t, got.IsAdmin)
	require.Empty(t, idp.calls)

	out, err := s.UpdateEmployee(ctx, head, target.ID, EmployeeInput{Position: ptr("Старший менеджер")})
	require.NoError(t, err)
	require.Equal(t, "Старший менеджер", out.Position)
}

func TestUpdateEmployee_HeadForeignOrPlainForbidden(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales, legal := seedDepartment(t, s, admin, "Продажи"), seedDepartment(t, s, admin, "Юристы")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	foreign := seed(t, s, func(e *domain.Employee) { e.DepartmentID = &legal })
	plain := seed(t, s, nil)
	_, err := s.UpdateEmployee(ctx, head, foreign.ID, EmployeeInput{Position: ptr("x")})
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, err = s.UpdateEmployee(ctx, plain, plain.ID, EmployeeInput{Position: ptr("x")})
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, err = s.UpdateEmployee(ctx, plain, plain.ID, EmployeeInput{})
	require.ErrorIs(t, err, domain.ErrForbidden)
}

func TestUpdateEmployee_TransferClearsHead(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	sales, legal := seedDepartment(t, s, admin, "Продажи"), seedDepartment(t, s, admin, "Юристы")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })

	out, err := s.UpdateEmployee(ctx, admin, head.ID, EmployeeInput{DepartmentID: ptr(&legal)})
	require.NoError(t, err)
	require.False(t, out.IsHead)

	out, err = s.UpdateEmployee(ctx, admin, head.ID, EmployeeInput{DepartmentID: ptr(&sales), IsHead: ptr(true)})
	require.NoError(t, err)
	require.True(t, out.IsHead)

	out, err = s.UpdateEmployee(ctx, admin, head.ID, EmployeeInput{DepartmentID: ptr[*uuid.UUID](nil)})
	require.NoError(t, err)
	require.False(t, out.IsHead)
}

func TestUpdateEmployee_HeadNeedsDepartment(t *testing.T) {
	s, _, _ := newService(t)
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	target := seed(t, s, nil)
	_, err := s.UpdateEmployee(context.Background(), admin, target.ID, EmployeeInput{IsHead: ptr(true)})
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	require.Equal(t, "no_department", v.Fields["is_head"])
}

func TestUpdateEmployee_EmailOfInvitedNeedsReinvite(t *testing.T) {
	s, _, _ := newService(t)
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	invited := seed(t, s, func(e *domain.Employee) { e.ActivatedAt = nil })
	_, err := s.UpdateEmployee(context.Background(), admin, invited.ID, EmployeeInput{Email: ptr("new@example.com")})
	require.ErrorIs(t, err, domain.ErrReinviteRequired)
}

func TestDeleteEmployee_OnlyInvitedRefusesActive(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	active := seed(t, s, nil)
	invited := seed(t, s, func(e *domain.Employee) { e.ActivatedAt = nil })
	require.ErrorIs(t, s.DeleteEmployee(ctx, admin, active.ID, true), domain.ErrAlreadyActive)
	got, err := s.Store.EmployeeByID(ctx, active.ID)
	require.NoError(t, err)
	require.Nil(t, got.DeletedAt)
	require.NoError(t, s.DeleteEmployee(ctx, admin, invited.ID, true))
}

func TestDeleteEmployee_HeadOnlyNotActivatedOwn(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales, legal := seedDepartment(t, s, admin, "Продажи"), seedDepartment(t, s, admin, "Юристы")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	active := seed(t, s, func(e *domain.Employee) { e.DepartmentID = &sales })
	foreign := seed(t, s, func(e *domain.Employee) { e.DepartmentID, e.ActivatedAt = &legal, nil })
	own := seed(t, s, func(e *domain.Employee) { e.DepartmentID, e.ActivatedAt = &sales, nil })
	require.ErrorIs(t, s.DeleteEmployee(ctx, head, active.ID, false), domain.ErrForbidden)
	require.ErrorIs(t, s.DeleteEmployee(ctx, head, foreign.ID, false), domain.ErrForbidden)
	require.NoError(t, s.DeleteEmployee(ctx, head, own.ID, false))
}

func TestCreateEmployee_HeadOnlyOwnDepartment(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales, legal := seedDepartment(t, s, admin, "Продажи"), seedDepartment(t, s, admin, "Юристы")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })

	inv, err := s.CreateEmployee(ctx, head, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)
	require.Equal(t, sales, *inv.Employee.DepartmentID)

	idp.calls = nil
	_, err = s.CreateEmployee(ctx, head, EmployeeInput{Email: ptr("other@example.com"), FirstName: ptr("Борис"), DepartmentID: ptr(&legal)})
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, err = s.CreateEmployee(ctx, head, EmployeeInput{Email: ptr("adm@example.com"), FirstName: ptr("Вера"), IsAdmin: ptr(true)})
	require.ErrorIs(t, err, domain.ErrForbidden)
	require.Empty(t, idp.calls)
}

func TestListAndGetEmployee_Scope(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales, legal := seedDepartment(t, s, admin, "Продажи"), seedDepartment(t, s, admin, "Юристы")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	own := seed(t, s, func(e *domain.Employee) { e.DepartmentID = &sales })
	foreign := seed(t, s, func(e *domain.Employee) { e.DepartmentID = &legal })
	plain := seed(t, s, nil)

	items, total, err := s.ListEmployees(ctx, head, store.EmployeeFilter{DepartmentID: &legal, Limit: 50})
	require.NoError(t, err)
	require.Equal(t, 2, total)
	require.Len(t, items, 2)
	for _, it := range items {
		require.Equal(t, sales, *it.DepartmentID)
	}
	_, _, err = s.ListEmployees(ctx, plain, store.EmployeeFilter{})
	require.ErrorIs(t, err, domain.ErrForbidden)

	_, err = s.GetEmployee(ctx, head, own.ID)
	require.NoError(t, err)
	_, err = s.GetEmployee(ctx, head, foreign.ID)
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, err = s.GetEmployee(ctx, plain, plain.ID)
	require.ErrorIs(t, err, domain.ErrForbidden)
}

func TestAdminOnlyOperations_ForbiddenForHead(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales := seedDepartment(t, s, admin, "Продажи")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	target := seed(t, s, func(e *domain.Employee) { e.DepartmentID = &sales })
	_, err := s.ResetPassword(ctx, head, target.ID)
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, err = s.CreateDepartment(ctx, head, DepartmentInput{Name: ptr("Новый")})
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, err = s.UpdateDepartment(ctx, head, sales, DepartmentInput{Name: ptr("Новый")})
	require.ErrorIs(t, err, domain.ErrForbidden)
	require.ErrorIs(t, s.DeleteDepartment(ctx, head, sales), domain.ErrForbidden)
	require.Empty(t, idp.calls)
}

func TestUpdateEmployee_WritesAudit(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	target := seed(t, s, func(e *domain.Employee) { e.Position = "Менеджер" })

	_, err := s.UpdateEmployee(ctx, admin, target.ID, EmployeeInput{Position: ptr("Старший менеджер")})
	require.NoError(t, err)

	items, total, err := s.ListAudit(ctx, admin, store.AuditFilter{TargetType: domain.TargetEmployee, TargetID: &target.ID})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "employee.update", items[0].Action)
	require.Equal(t, admin.ID, *items[0].ActorID)
	require.Equal(t, map[string]any{"position": map[string]any{"from": "Менеджер", "to": "Старший менеджер"}}, items[0].Details)
}

func TestUpdateEmployee_NoChangeWritesNoAudit(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	target := seed(t, s, func(e *domain.Employee) { e.Position = "Менеджер" })
	_, err := s.UpdateEmployee(ctx, admin, target.ID, EmployeeInput{Position: ptr("Менеджер")})
	require.NoError(t, err)
	_, total, err := s.ListAudit(ctx, admin, store.AuditFilter{})
	require.NoError(t, err)
	require.Zero(t, total)
}

func TestUpdateEmployee_AuditRolledBackWithChange(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	target := seed(t, s, nil)
	idp.err = domain.ErrIdPUnavailable

	_, err := s.UpdateEmployee(ctx, admin, target.ID, EmployeeInput{FirstName: ptr("Новое")})
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
	_, total, err := s.ListAudit(ctx, admin, store.AuditFilter{TargetType: domain.TargetEmployee, TargetID: &target.ID})
	require.NoError(t, err)
	require.Zero(t, total)
}

func TestListAudit_AdminOnly(t *testing.T) {
	s, _, _ := newService(t)
	admin := seedAdmin(t, s)
	sales := seedDepartment(t, s, admin, "Продажи")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	_, _, err := s.ListAudit(context.Background(), head, store.AuditFilter{})
	require.ErrorIs(t, err, domain.ErrForbidden)
}

func TestDeleteAndResetPassword_WriteAudit(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	target := seed(t, s, nil)
	_, err := s.ResetPassword(ctx, admin, target.ID)
	require.NoError(t, err)
	require.NoError(t, s.DeleteEmployee(ctx, admin, target.ID, false))
	items, total, err := s.ListAudit(ctx, admin, store.AuditFilter{TargetType: domain.TargetEmployee, TargetID: &target.ID})
	require.NoError(t, err)
	require.Equal(t, 2, total)
	require.Equal(t, "employee.delete", items[0].Action)
	require.Equal(t, map[string]any{"email": target.Email}, items[0].Details)
	require.Equal(t, "employee.reset_password", items[1].Action)
}

func createEmployee(ctx context.Context, t *testing.T, s *Service, actor domain.Employee, in EmployeeInput) domain.Employee {
	t.Helper()
	inv, err := s.CreateEmployee(ctx, actor, in)
	require.NoError(t, err)
	return inv.Employee
}
