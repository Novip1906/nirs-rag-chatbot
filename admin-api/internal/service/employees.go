package service

import (
	"context"
	"errors"
	"log/slog"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

const (
	maxPersonName       = 100
	maxPosition         = 200
	maxEmail            = 254
	operationTimeout    = 30 * time.Second
	compensationTimeout = 10 * time.Second
)

func detached(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), timeout)
}

func sameEmployee(a, b domain.Employee) bool {
	return sameDepartment(a, b) && a.Email == b.Email && a.FirstName == b.FirstName && a.LastName == b.LastName &&
		a.Position == b.Position && a.IsAdmin == b.IsAdmin && a.IsHead == b.IsHead && a.Blocked == b.Blocked
}

type EmployeeInput struct {
	Email        *string
	FirstName    *string
	LastName     *string
	Position     *string
	DepartmentID **uuid.UUID
	IsAdmin      *bool
	IsHead       *bool
	Blocked      *bool
}

func (in EmployeeInput) Touched() []string {
	var out []string
	for _, f := range []struct {
		name string
		set  bool
	}{
		{domain.FieldEmail, in.Email != nil},
		{domain.FieldFirstName, in.FirstName != nil},
		{domain.FieldLastName, in.LastName != nil},
		{domain.FieldPosition, in.Position != nil},
		{domain.FieldDepartment, in.DepartmentID != nil},
		{domain.FieldIsAdmin, in.IsAdmin != nil},
		{domain.FieldIsHead, in.IsHead != nil},
		{domain.FieldBlocked, in.Blocked != nil},
	} {
		if f.set {
			out = append(out, f.name)
		}
	}
	return out
}

func sameDepartment(a, b domain.Employee) bool {
	return (a.DepartmentID == nil) == (b.DepartmentID == nil) && (a.DepartmentID == nil || *a.DepartmentID == *b.DepartmentID)
}

func idpProfile(e domain.Employee) keycloak.Profile {
	return keycloak.Profile{Email: e.Email, FirstName: e.FirstName, LastName: e.LastName, Enabled: !e.Blocked}
}

func wasActiveAdmin(e domain.Employee) bool {
	return e.IsAdmin && !e.Blocked && e.ActivatedAt != nil
}

func guardSelf(actorID uuid.UUID, cur, next domain.Employee) error {
	if actorID != cur.ID {
		return nil
	}
	if cur.IsAdmin && !next.IsAdmin {
		return domain.ErrSelfAdminRevoke
	}
	if !cur.Blocked && next.Blocked {
		return domain.ErrSelfBlock
	}
	return nil
}

func requiredText(fields map[string]string, key string, v *string, max int, dst *string) {
	if v == nil {
		return
	}
	t := strings.TrimSpace(*v)
	switch {
	case t == "":
		fields[key] = "required"
	case utf8.RuneCountInString(t) > max:
		fields[key] = "too_long"
	default:
		*dst = t
	}
}

func normalizeEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > maxEmail {
		return "", false
	}
	return email, true
}

func applyInput(cur domain.Employee, in EmployeeInput) (domain.Employee, error) {
	fields := map[string]string{}
	next := cur
	if in.Email != nil {
		if email, ok := normalizeEmail(*in.Email); ok {
			next.Email = email
		} else {
			fields["email"] = "invalid"
		}
	}
	requiredText(fields, "first_name", in.FirstName, maxPersonName, &next.FirstName)
	if in.LastName != nil {
		l := strings.TrimSpace(*in.LastName)
		if utf8.RuneCountInString(l) > maxPersonName {
			fields["last_name"] = "too_long"
		} else {
			next.LastName = l
		}
	}
	if in.Position != nil {
		p := strings.TrimSpace(*in.Position)
		if utf8.RuneCountInString(p) > maxPosition {
			fields["position"] = "too_long"
		} else {
			next.Position = p
		}
	}
	if in.DepartmentID != nil {
		next.DepartmentID = *in.DepartmentID
	}
	if in.IsAdmin != nil {
		next.IsAdmin = *in.IsAdmin
	}
	if in.Blocked != nil {
		next.Blocked = *in.Blocked
	}
	if in.IsHead != nil {
		next.IsHead = *in.IsHead
	} else if !sameDepartment(cur, next) {
		next.IsHead = false
	}
	if next.IsHead && next.DepartmentID == nil {
		fields["is_head"] = "no_department"
	}
	if len(fields) > 0 {
		return domain.Employee{}, &domain.ValidationError{Fields: fields}
	}
	return next, nil
}

func checkDepartment(ctx context.Context, tx *store.Tx, in EmployeeInput) error {
	if in.DepartmentID == nil || *in.DepartmentID == nil {
		return nil
	}
	err := tx.DepartmentForShare(ctx, **in.DepartmentID)
	if errors.Is(err, domain.ErrNotFound) {
		return &domain.ValidationError{Fields: map[string]string{"department_id": "unknown"}}
	}
	return err
}

func (s *Service) ListEmployees(ctx context.Context, actor domain.Employee, f store.EmployeeFilter) ([]domain.Employee, int, error) {
	switch {
	case actor.Admin():
	case actor.Head():
		f.DepartmentID, f.NoDepartment = actor.DepartmentID, false
	default:
		return nil, 0, domain.ErrForbidden
	}
	return s.Store.ListEmployees(ctx, f)
}

func (s *Service) GetEmployee(ctx context.Context, actor domain.Employee, id uuid.UUID) (domain.Employee, error) {
	e, err := s.Store.EmployeeByID(ctx, id)
	if err != nil {
		return domain.Employee{}, err
	}
	if e.DeletedAt != nil {
		return domain.Employee{}, domain.ErrNotFound
	}
	if !domain.CanView(actor, e) {
		return domain.Employee{}, domain.ErrForbidden
	}
	return e, nil
}

func (s *Service) UpdateEmployee(ctx context.Context, actor domain.Employee, id uuid.UUID, in EmployeeInput) (domain.Employee, error) {
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	var out domain.Employee
	var logout, changed bool
	err := s.Store.InTx(opCtx, func(tx *store.Tx) error {
		cur, err := tx.LockEmployee(opCtx, id)
		if err != nil {
			return err
		}
		allowed := domain.EditableFields(actor, cur)
		if len(allowed) == 0 {
			return domain.ErrForbidden
		}
		for _, f := range in.Touched() {
			if !allowed[f] {
				return domain.ErrForbidden
			}
		}
		next, err := applyInput(cur, in)
		if err != nil {
			return err
		}
		if next.Email != cur.Email && cur.ActivatedAt == nil {
			return domain.ErrReinviteRequired
		}
		if sameEmployee(cur, next) {
			out = cur
			return nil
		}
		if err := checkDepartment(opCtx, tx, in); err != nil {
			return err
		}
		if err := guardSelf(actor.ID, cur, next); err != nil {
			return err
		}
		if wasActiveAdmin(cur) && !wasActiveAdmin(next) {
			if err := tx.LockAdmins(opCtx); err != nil {
				return err
			}
			n, err := tx.CountActiveAdmins(opCtx)
			if err != nil {
				return err
			}
			if n <= 1 {
				return domain.ErrLastAdmin
			}
		}
		out, err = tx.SaveEmployee(opCtx, next)
		if err != nil {
			return err
		}
		if idpProfile(cur) != idpProfile(next) {
			if err := s.IdP.UpdateUser(opCtx, next.Sub, idpProfile(next)); err != nil {
				return err
			}
		}
		if err := tx.InsertAudit(opCtx, &actor.ID, "employee.update", domain.TargetEmployee, cur.ID, employeeDiff(cur, next)); err != nil {
			return err
		}
		logout = !cur.Blocked && next.Blocked
		changed = true
		return nil
	})
	if err != nil {
		return domain.Employee{}, err
	}
	if !changed {
		return out, nil
	}
	if logout {
		logoutCtx, cancelLogout := detached(ctx, compensationTimeout)
		defer cancelLogout()
		if err := s.IdP.Logout(logoutCtx, out.Sub); err != nil {
			slog.Warn("не удалось завершить сессии заблокированного сотрудника", "id", out.ID, "error", err)
		}
	}
	s.Notifier.EmployeeChanged(out.ID)
	return out, nil
}

func (s *Service) DeleteEmployee(ctx context.Context, actor domain.Employee, id uuid.UUID, onlyInvited bool) error {
	if actor.ID == id {
		return domain.ErrSelfDelete
	}
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	var refused error
	err := s.Store.InTx(opCtx, func(tx *store.Tx) error {
		cur, err := tx.LockEmployee(opCtx, id)
		if err != nil {
			return err
		}
		if !domain.CanDelete(actor, cur) {
			return domain.ErrForbidden
		}
		if onlyInvited && cur.ActivatedAt != nil {
			return domain.ErrAlreadyActive
		}
		if cur.ActivatedAt == nil {
			has, err := s.passwordSet(opCtx, cur.Sub)
			if err != nil {
				return err
			}
			if has {
				now := s.Now()
				cur.ActivatedAt = &now
				if cur, err = tx.SaveEmployee(opCtx, cur); err != nil {
					return err
				}
				switch {
				case onlyInvited:
					refused = domain.ErrAlreadyActive
				case !domain.CanDelete(actor, cur):
					refused = domain.ErrForbidden
				}
				if refused != nil {
					return nil
				}
			}
		}
		if wasActiveAdmin(cur) {
			if err := tx.LockAdmins(opCtx); err != nil {
				return err
			}
			n, err := tx.CountActiveAdmins(opCtx)
			if err != nil {
				return err
			}
			if n <= 1 {
				return domain.ErrLastAdmin
			}
		}
		if err := tx.SoftDeleteEmployee(opCtx, id); err != nil {
			return err
		}
		if err := tx.InsertAudit(opCtx, &actor.ID, "employee.delete", domain.TargetEmployee, id, map[string]any{"email": cur.Email}); err != nil {
			return err
		}
		return s.IdP.DeleteUser(opCtx, cur.Sub)
	})
	if err != nil {
		return err
	}
	s.Notifier.EmployeeChanged(id)
	return refused
}

func (s *Service) ResetPassword(ctx context.Context, actor domain.Employee, id uuid.UUID) (string, error) {
	if !actor.Admin() {
		return "", domain.ErrForbidden
	}
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	e, err := s.Store.EmployeeByID(opCtx, id)
	if err != nil {
		return "", err
	}
	if e.DeletedAt != nil {
		return "", domain.ErrNotFound
	}
	if e.ActivatedAt == nil {
		return "", domain.ErrNotActivated
	}
	pwd := s.NewPassword()
	if err := s.IdP.SetPassword(opCtx, e.Sub, pwd); err != nil {
		return "", err
	}
	err = s.Store.InTx(opCtx, func(tx *store.Tx) error {
		return tx.InsertAudit(opCtx, &actor.ID, "employee.reset_password", domain.TargetEmployee, e.ID, nil)
	})
	if err != nil {
		slog.Error("пароль сброшен, но запись в журнал не сделана", "id", e.ID, "actor", actor.ID, "error", err)
	}
	if err := s.IdP.Logout(opCtx, e.Sub); err != nil {
		slog.Warn("не удалось завершить сессии после смены пароля", "id", e.ID, "error", err)
	}
	return pwd, nil
}
