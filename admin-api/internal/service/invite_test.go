package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func TestCreateEmployee_Invites(t *testing.T) {
	s, idp, n := newService(t)
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	inv, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)
	require.Equal(t, "https://auth.test/link/"+inv.Employee.Sub, inv.Link)
	require.True(t, inv.EmailSent)
	require.Nil(t, inv.Employee.ActivatedAt)
	require.Equal(t, admin.ID, *inv.Employee.InvitedBy)
	require.True(t, s.Now().Add(s.InviteTTL).Equal(*inv.Employee.InviteExpiresAt))
	require.Equal(t, domain.StatusInvited, inv.Employee.Status(s.Now()))
	require.False(t, idp.accounts[inv.Employee.Sub])
	require.Contains(t, n.employees, inv.Employee.ID)
}

func TestCreateEmployee_LinkFailureLeavesNothing(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	idp.linkErr = domain.ErrIdPUnavailable
	_, err := s.CreateEmployee(context.Background(), admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
	taken, err := s.Store.EmailTaken(context.Background(), "new@example.com")
	require.NoError(t, err)
	require.False(t, taken)
	require.Empty(t, idp.byEmail)
}

func TestCreateEmployee_WritesInviteAudit(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)
	items, total, err := s.Store.ListAudit(ctx, auditFor(inv.Employee.ID))
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "employee.invite", items[0].Action)
	require.Equal(t, map[string]any{"email": "new@example.com"}, items[0].Details)
}

func TestReinvite_NewAccountSameEmployee(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	first, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)

	second, err := s.Reinvite(ctx, admin, first.Employee.ID, nil)
	require.NoError(t, err)
	require.Equal(t, first.Employee.ID, second.Employee.ID)
	require.NotEqual(t, first.Employee.Sub, second.Employee.Sub)
	_, oldExists := idp.accounts[first.Employee.Sub]
	require.False(t, oldExists)
	require.NotEqual(t, first.Link, second.Link)
	items, total, err := s.Store.ListAudit(ctx, auditFor(first.Employee.ID))
	require.NoError(t, err)
	require.Equal(t, 2, total)
	require.Equal(t, "employee.reinvite", items[0].Action)
	require.Equal(t, map[string]any{"email": "new@example.com"}, items[0].Details)
}

func TestReinvite_AlreadyHasPassword(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)
	idp.accounts[inv.Employee.Sub] = true
	n.employees = nil

	_, err = s.Reinvite(ctx, admin, inv.Employee.ID, nil)
	require.ErrorIs(t, err, domain.ErrAlreadyActive)
	got, err := s.Store.EmployeeByID(ctx, inv.Employee.ID)
	require.NoError(t, err)
	require.Equal(t, inv.Employee.Sub, got.Sub)
	require.NotNil(t, got.ActivatedAt)
	require.Contains(t, n.employees, inv.Employee.ID)
}

func TestReinvite_ResumesAfterPartialFailure(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)

	idp.failCreate = domain.ErrIdPUnavailable
	_, err = s.Reinvite(ctx, admin, inv.Employee.ID, nil)
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
	require.Empty(t, idp.accounts)

	idp.failCreate = nil
	again, err := s.Reinvite(ctx, admin, inv.Employee.ID, nil)
	require.NoError(t, err)
	require.NotEqual(t, inv.Employee.Sub, again.Employee.Sub)
	require.Contains(t, idp.accounts, again.Employee.Sub)
}

func TestReinvite_ReplacesOrphanAccount(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)
	delete(idp.accounts, inv.Employee.Sub)
	idp.accounts["orphan"] = false
	idp.byEmail["new@example.com"] = "orphan"

	again, err := s.Reinvite(ctx, admin, inv.Employee.ID, nil)
	require.NoError(t, err)
	_, orphanExists := idp.accounts["orphan"]
	require.False(t, orphanExists)
	require.Contains(t, idp.accounts, again.Employee.Sub)
}

func TestReinvite_KeepsForeignAccountWithPassword(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("new@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)
	delete(idp.accounts, inv.Employee.Sub)
	delete(idp.byEmail, "new@example.com")
	idp.accounts["foreign"] = true
	idp.byEmail["new@example.com"] = "foreign"

	_, err = s.Reinvite(ctx, admin, inv.Employee.ID, nil)
	require.ErrorIs(t, err, domain.ErrEmailTaken)
	require.Contains(t, idp.accounts, "foreign")
}

func TestReinvite_ChangesEmail(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	other := seed(t, s, nil)
	inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("typo@example.com"), FirstName: ptr("Анна")})
	require.NoError(t, err)

	_, err = s.Reinvite(ctx, admin, inv.Employee.ID, ptr(other.Email))
	require.ErrorIs(t, err, domain.ErrEmailTaken)
	_, err = s.Reinvite(ctx, admin, inv.Employee.ID, ptr("не-почта"))
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	fixed, err := s.Reinvite(ctx, admin, inv.Employee.ID, ptr(" Right@Example.com "))
	require.NoError(t, err)
	require.Equal(t, "right@example.com", fixed.Employee.Email)
	items, _, err := s.Store.ListAudit(ctx, auditFor(inv.Employee.ID))
	require.NoError(t, err)
	require.Equal(t, "employee.reinvite", items[0].Action)
	require.Equal(t, map[string]any{"email": map[string]any{"from": "typo@example.com", "to": "right@example.com"}}, items[0].Details)
}

func TestReinvite_HeadForeignDepartmentForbidden(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales, legal := seedDepartment(t, s, admin, "Продажи"), seedDepartment(t, s, admin, "Юристы")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	own := createEmployee(ctx, t, s, head, EmployeeInput{Email: ptr("own@example.com"), FirstName: ptr("Анна")})
	foreign := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("foreign@example.com"), FirstName: ptr("Борис"), DepartmentID: ptr(&legal)})
	idp.calls = nil

	_, err := s.Reinvite(ctx, head, foreign.ID, nil)
	require.ErrorIs(t, err, domain.ErrForbidden)
	require.Empty(t, idp.calls)
	_, err = s.Reinvite(ctx, head, own.ID, nil)
	require.NoError(t, err)
}

func TestReinvite_UnknownEmployee(t *testing.T) {
	s, _, _ := newService(t)
	admin := seedAdmin(t, s)
	_, err := s.Reinvite(context.Background(), admin, uuid.New(), nil)
	require.ErrorIs(t, err, domain.ErrNotFound)
}

func TestResetPassword_NotActivated(t *testing.T) {
	s, idp, _ := newService(t)
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	invited := seed(t, s, func(e *domain.Employee) { e.ActivatedAt = nil })
	_, err := s.ResetPassword(context.Background(), admin, invited.ID)
	require.ErrorIs(t, err, domain.ErrNotActivated)
	require.Empty(t, idp.calls)
}

func TestRefreshActivation_MarksThoseWithPassword(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	a, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А")})
	require.NoError(t, err)
	b, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("b@example.com"), FirstName: ptr("Б")})
	require.NoError(t, err)
	idp.accounts[a.Employee.Sub] = true
	n.employees = nil

	count, err := s.RefreshActivation(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
	gotA, _ := s.Store.EmployeeByID(ctx, a.Employee.ID)
	gotB, _ := s.Store.EmployeeByID(ctx, b.Employee.ID)
	require.NotNil(t, gotA.ActivatedAt)
	require.Nil(t, gotB.ActivatedAt)
	require.Equal(t, []uuid.UUID{a.Employee.ID}, n.employees)

	count, err = s.RefreshActivation(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestRefreshActivation_SkipsMissingAccount(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	a, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А")})
	require.NoError(t, err)
	delete(idp.accounts, a.Employee.Sub)
	count, err := s.RefreshActivation(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestRefreshActivation_ListFailureIsError(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А")})
	idp.err = domain.ErrIdPUnavailable
	count, err := s.RefreshActivation(ctx)
	require.NoError(t, err)
	require.Zero(t, count)

	require.NoError(t, s.Store.Close())
	_, err = s.RefreshActivation(ctx)
	require.Error(t, err)
}

func TestRefreshActivation_ContinuesAfterEmployeeError(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	a := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А")})
	b := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("b@example.com"), FirstName: ptr("Б")})
	idp.passwordErr[a.Sub] = domain.ErrIdPUnavailable
	idp.accounts[b.Sub] = true
	n.employees = nil

	count, err := s.RefreshActivation(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
	gotA, _ := s.Store.EmployeeByID(ctx, a.ID)
	gotB, _ := s.Store.EmployeeByID(ctx, b.ID)
	require.Nil(t, gotA.ActivatedAt)
	require.NotNil(t, gotB.ActivatedAt)
	require.Equal(t, []uuid.UUID{b.ID}, n.employees)
}

func TestRefreshActivation_ReinviteInBetweenIsNotActivated(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А")})
	fired := false
	idp.onPassword = func(string) *bool {
		if fired {
			return nil
		}
		fired = true
		_, err := s.Reinvite(ctx, admin, e.ID, nil)
		require.NoError(t, err)
		n.employees = nil
		return ptr(true)
	}

	count, err := s.RefreshActivation(ctx)
	require.NoError(t, err)
	require.True(t, fired)
	require.Zero(t, count)
	got, err := s.Store.EmployeeByID(ctx, e.ID)
	require.NoError(t, err)
	require.NotEqual(t, e.Sub, got.Sub)
	require.Nil(t, got.ActivatedAt)
	require.Empty(t, n.employees)
}

func TestReinviteAndDelete_HeadCannotTouchPrivileged(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales := seedDepartment(t, s, admin, "Продажи")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	invitedAdmin := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("boss@example.com"), FirstName: ptr("А"), DepartmentID: ptr(&sales), IsAdmin: ptr(true)})
	invitedHead := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("lead@example.com"), FirstName: ptr("Б"), DepartmentID: ptr(&sales), IsHead: ptr(true)})
	idp.calls = nil

	for _, target := range []domain.Employee{invitedAdmin, invitedHead} {
		_, err := s.Reinvite(ctx, head, target.ID, nil)
		require.ErrorIs(t, err, domain.ErrForbidden)
		require.ErrorIs(t, s.DeleteEmployee(ctx, head, target.ID, true), domain.ErrForbidden)
		require.ErrorIs(t, s.DeleteEmployee(ctx, head, target.ID, false), domain.ErrForbidden)
		got, err := s.Store.EmployeeByID(ctx, target.ID)
		require.NoError(t, err)
		require.Equal(t, target.Sub, got.Sub)
		require.Nil(t, got.DeletedAt)
	}
	require.Empty(t, idp.calls)

	_, err := s.Reinvite(ctx, admin, invitedAdmin.ID, nil)
	require.NoError(t, err)
	require.NoError(t, s.DeleteEmployee(ctx, admin, invitedHead.ID, true))
}

func TestDeleteEmployee_InvitedWhoAlreadySetPassword(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	sales := seedDepartment(t, s, admin, "Продажи")
	head := seed(t, s, func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales })
	invite := func(email string) domain.Employee {
		e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr(email), FirstName: ptr("А"), DepartmentID: ptr(&sales)})
		idp.accounts[e.Sub] = true
		return e
	}
	revoked, byHead, byAdmin, unknown := invite("a@example.com"), invite("b@example.com"), invite("c@example.com"), invite("d@example.com")
	n.employees, idp.calls = nil, nil

	require.ErrorIs(t, s.DeleteEmployee(ctx, admin, revoked.ID, true), domain.ErrAlreadyActive)
	require.ErrorIs(t, s.DeleteEmployee(ctx, head, byHead.ID, false), domain.ErrForbidden)
	for _, e := range []domain.Employee{revoked, byHead} {
		got, err := s.Store.EmployeeByID(ctx, e.ID)
		require.NoError(t, err)
		require.NotNil(t, got.ActivatedAt)
		require.Nil(t, got.DeletedAt)
		require.Contains(t, idp.accounts, e.Sub)
		require.Contains(t, n.employees, e.ID)
	}
	require.Empty(t, idp.calls)

	require.NoError(t, s.DeleteEmployee(ctx, admin, byAdmin.ID, false))
	got, err := s.Store.EmployeeByID(ctx, byAdmin.ID)
	require.NoError(t, err)
	require.NotNil(t, got.ActivatedAt)
	require.NotNil(t, got.DeletedAt)

	idp.passwordErr[unknown.Sub] = domain.ErrIdPUnavailable
	require.ErrorIs(t, s.DeleteEmployee(ctx, admin, unknown.ID, true), domain.ErrIdPUnavailable)
	got, err = s.Store.EmployeeByID(ctx, unknown.ID)
	require.NoError(t, err)
	require.Nil(t, got.DeletedAt)
	require.Nil(t, got.ActivatedAt)
}

func TestCreateEmployee_ReplacesOrphanAccount(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	for email, owner := range map[string]string{"free@example.com": "", "gone@example.com": uuid.NewString()} {
		orphan := "orphan-" + email
		idp.accounts[orphan], idp.byEmail[email] = false, orphan
		if owner != "" {
			idp.owners[orphan] = owner
		}
		inv, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr(email), FirstName: ptr("Анна")})
		require.NoError(t, err)
		require.NotContains(t, idp.accounts, orphan)
		require.Contains(t, idp.accounts, inv.Employee.Sub)
		require.Equal(t, inv.Employee.ID.String(), idp.owners[inv.Employee.Sub])
	}
}

func TestCreateEmployee_KeepsLiveForeignAccount(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	other := seed(t, s, nil)
	idp.accounts["foreign"], idp.byEmail["new@example.com"], idp.owners["foreign"] = false, "foreign", other.ID.String()
	idp.accounts["used"], idp.byEmail["used@example.com"] = true, "used"

	for _, email := range []string{"new@example.com", "used@example.com"} {
		_, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr(email), FirstName: ptr("Анна")})
		require.ErrorIs(t, err, domain.ErrEmailTaken)
		taken, err := s.Store.EmailTaken(ctx, email)
		require.NoError(t, err)
		require.False(t, taken)
	}
	require.Contains(t, idp.accounts, "foreign")
	require.Contains(t, idp.accounts, "used")
	require.NotContains(t, idp.calls, "delete:foreign")
	require.NotContains(t, idp.calls, "delete:used")
}

func TestReinvite_OrphanOwnership(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	other := seed(t, s, nil)
	e := createEmployee(ctx, t, s, admin, EmployeeInput{Email: ptr("typo@example.com"), FirstName: ptr("Анна")})
	idp.accounts["foreign"], idp.byEmail["busy@example.com"], idp.owners["foreign"] = false, "foreign", other.ID.String()
	idp.accounts["mine"], idp.byEmail["right@example.com"], idp.owners["mine"] = false, "mine", e.ID.String()

	_, err := s.Reinvite(ctx, admin, e.ID, ptr("busy@example.com"))
	require.ErrorIs(t, err, domain.ErrEmailTaken)
	require.Contains(t, idp.accounts, "foreign")

	again, err := s.Reinvite(ctx, admin, e.ID, ptr("right@example.com"))
	require.NoError(t, err)
	require.NotContains(t, idp.accounts, "mine")
	require.Contains(t, idp.accounts, again.Employee.Sub)
}

func TestResetPassword_AuditFailureKeepsResult(t *testing.T) {
	s, idp, _ := newService(t)
	ctx := context.Background()
	ghost := domain.Employee{ID: uuid.New(), Sub: "ghost", IsAdmin: true}
	e := seed(t, s, nil)
	pwd, err := s.ResetPassword(ctx, ghost, e.ID)
	require.NoError(t, err)
	require.Equal(t, "Tmp-pass-1", pwd)
	require.Equal(t, []string{"password", "logout:" + e.Sub}, idp.calls)
	_, total, err := s.Store.ListAudit(ctx, auditFor(e.ID))
	require.NoError(t, err)
	require.Zero(t, total)
}

func TestLastAdminGuard_IgnoresNeverLoggedIn(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	only := seedAdmin(t, s)
	invited := seed(t, s, func(e *domain.Employee) { e.IsAdmin, e.ActivatedAt = true, nil })
	_, err := s.UpdateEmployee(ctx, invited, only.ID, EmployeeInput{IsAdmin: ptr(false)})
	require.ErrorIs(t, err, domain.ErrLastAdmin)
	_, err = s.UpdateEmployee(ctx, invited, only.ID, EmployeeInput{Blocked: ptr(true)})
	require.ErrorIs(t, err, domain.ErrLastAdmin)
	require.ErrorIs(t, s.DeleteEmployee(ctx, invited, only.ID, false), domain.ErrLastAdmin)
	require.NoError(t, s.DeleteEmployee(ctx, only, invited.ID, false))
}
