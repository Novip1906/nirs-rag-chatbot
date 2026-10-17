package service

import (
	"context"
	"errors"
	"log/slog"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

type Invite struct {
	Employee  domain.Employee
	Link      string
	EmailSent bool
}

func ptr[T any](v T) *T { return &v }

func mergeFields(fields map[string]string, err error) (bool, error) {
	var v *domain.ValidationError
	switch {
	case errors.As(err, &v):
		for k, val := range v.Fields {
			fields[k] = val
		}
		return true, nil
	case err != nil:
		return false, err
	}
	return false, nil
}

func (s *Service) CreateEmployee(ctx context.Context, actor domain.Employee, in EmployeeInput) (Invite, error) {
	if !actor.Admin() && (in.IsAdmin != nil || in.IsHead != nil || in.Blocked != nil) {
		return Invite{}, domain.ErrForbidden
	}
	var target *uuid.UUID
	if in.DepartmentID != nil {
		target = *in.DepartmentID
	}
	if target == nil && actor.Head() {
		own := actor.DepartmentID
		in.DepartmentID, target = &own, own
	}
	if !domain.CanInvite(actor, target) {
		return Invite{}, domain.ErrForbidden
	}
	fields := map[string]string{}
	if in.Email == nil {
		fields["email"] = "required"
	}
	if in.FirstName == nil {
		fields["first_name"] = "required"
	}
	e, err := applyInput(domain.Employee{ID: uuid.New()}, in)
	if _, err := mergeFields(fields, err); err != nil {
		return Invite{}, err
	}
	err = s.Store.InTx(ctx, func(tx *store.Tx) error { return checkDepartment(ctx, tx, in) })
	if _, err := mergeFields(fields, err); err != nil {
		return Invite{}, err
	}
	if len(fields) > 0 {
		return Invite{}, &domain.ValidationError{Fields: fields}
	}
	if err := ctx.Err(); err != nil {
		return Invite{}, err
	}
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	taken, err := s.Store.EmailTaken(opCtx, e.Email)
	if err != nil {
		return Invite{}, err
	}
	if taken {
		return Invite{}, domain.ErrEmailTaken
	}
	sub, err := s.freshAccount(opCtx, e)
	if err != nil {
		return Invite{}, err
	}
	var out Invite
	err = s.Store.InTx(opCtx, func(tx *store.Tx) error {
		if err := checkDepartment(opCtx, tx, in); err != nil {
			return err
		}
		now := s.Now()
		e.Sub, e.InvitedAt, e.InviteExpiresAt, e.InvitedBy = sub, &now, ptr(now.Add(s.InviteTTL)), &actor.ID
		saved, err := tx.InsertEmployee(opCtx, e)
		if err != nil {
			return err
		}
		if err := tx.InsertAudit(opCtx, &actor.ID, "employee.invite", domain.TargetEmployee, saved.ID, map[string]any{"email": saved.Email}); err != nil {
			return err
		}
		link, err := s.IdP.MagicLink(opCtx, sub, saved.Email, s.InviteTTL)
		if err != nil {
			return err
		}
		out = Invite{Employee: saved, Link: link.Link, EmailSent: link.Sent}
		return nil
	})
	if err != nil {
		compCtx, cancelComp := detached(ctx, compensationTimeout)
		defer cancelComp()
		if delErr := s.IdP.DeleteUser(compCtx, sub); delErr != nil {
			slog.Error("не удалось откатить учётную запись", "sub", sub, "email", e.Email, "error", delErr)
		}
		return Invite{}, err
	}
	s.Notifier.EmployeeChanged(out.Employee.ID)
	return out, nil
}

func (s *Service) Reinvite(ctx context.Context, actor domain.Employee, id uuid.UUID, email *string) (Invite, error) {
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	var out Invite
	var activated bool
	err := s.Store.InTx(opCtx, func(tx *store.Tx) error {
		cur, err := tx.LockEmployee(opCtx, id)
		if err != nil {
			return err
		}
		if !domain.CanReinvite(actor, cur) {
			return domain.ErrForbidden
		}
		if cur.ActivatedAt != nil {
			return domain.ErrAlreadyActive
		}
		has, err := s.passwordSet(opCtx, cur.Sub)
		if err != nil {
			return err
		}
		now := s.Now()
		if has {
			cur.ActivatedAt = &now
			out.Employee, err = tx.SaveEmployee(opCtx, cur)
			activated = err == nil
			return err
		}
		next := cur
		if email != nil {
			normalized, ok := normalizeEmail(*email)
			if !ok {
				return &domain.ValidationError{Fields: map[string]string{"email": "invalid"}}
			}
			taken, err := s.Store.EmailTakenByOther(opCtx, normalized, cur.ID)
			if err != nil {
				return err
			}
			if taken {
				return domain.ErrEmailTaken
			}
			next.Email = normalized
		}
		if err := s.IdP.DeleteUser(opCtx, cur.Sub); err != nil {
			return err
		}
		sub, err := s.freshAccount(opCtx, next)
		if err != nil {
			return err
		}
		next.Sub, next.InvitedAt, next.InviteExpiresAt, next.InvitedBy = sub, &now, ptr(now.Add(s.InviteTTL)), &actor.ID
		saved, err := tx.SaveEmployee(opCtx, next)
		if err != nil {
			return err
		}
		details := map[string]any{"email": saved.Email}
		if saved.Email != cur.Email {
			details["email"] = map[string]any{"from": cur.Email, "to": saved.Email}
		}
		if err := tx.InsertAudit(opCtx, &actor.ID, "employee.reinvite", domain.TargetEmployee, saved.ID, details); err != nil {
			return err
		}
		link, err := s.IdP.MagicLink(opCtx, sub, saved.Email, s.InviteTTL)
		if err != nil {
			return err
		}
		out = Invite{Employee: saved, Link: link.Link, EmailSent: link.Sent}
		return nil
	})
	if activated {
		s.Notifier.EmployeeChanged(id)
		return Invite{}, domain.ErrAlreadyActive
	}
	if err != nil {
		return Invite{}, err
	}
	s.Notifier.EmployeeChanged(id)
	return out, nil
}

func (s *Service) freshAccount(ctx context.Context, e domain.Employee) (string, error) {
	sub, err := s.IdP.CreateInvited(ctx, e.ID.String(), idpProfile(e))
	if !errors.Is(err, domain.ErrEmailTaken) {
		return sub, err
	}
	orphan, found, err := s.IdP.FindByEmail(ctx, e.Email)
	if err != nil {
		return "", err
	}
	if !found {
		return "", domain.ErrIdPRejected
	}
	has, err := s.IdP.HasPassword(ctx, orphan.ID)
	if err != nil {
		return "", err
	}
	if has {
		return "", domain.ErrEmailTaken
	}
	foreign, err := s.ownedByOther(ctx, orphan.EmployeeID, e.ID)
	if err != nil {
		return "", err
	}
	if foreign {
		return "", domain.ErrEmailTaken
	}
	if err := s.IdP.DeleteUser(ctx, orphan.ID); err != nil {
		return "", err
	}
	return s.IdP.CreateInvited(ctx, e.ID.String(), idpProfile(e))
}

func (s *Service) ownedByOther(ctx context.Context, ownerID string, id uuid.UUID) (bool, error) {
	owner, err := uuid.Parse(ownerID)
	if err != nil || owner == id {
		return false, nil
	}
	other, err := s.Store.EmployeeByID(ctx, owner)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return other.DeletedAt == nil, nil
}

func (s *Service) passwordSet(ctx context.Context, sub string) (bool, error) {
	has, err := s.IdP.HasPassword(ctx, sub)
	if errors.Is(err, domain.ErrIdPAccountMissing) {
		return false, nil
	}
	return has, err
}

func (s *Service) RefreshActivation(ctx context.Context) (int, error) {
	pending, err := s.Store.PendingEmployees(ctx)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, e := range pending {
		if ctx.Err() != nil {
			break
		}
		has, err := s.passwordSet(ctx, e.Sub)
		if err != nil {
			slog.Error("не удалось проверить пароль приглашённого", "id", e.ID, "error", err)
			continue
		}
		if !has {
			continue
		}
		marked, err := s.markActivated(ctx, e)
		if err != nil {
			slog.Error("не удалось отметить приглашённого вошедшим", "id", e.ID, "error", err)
			continue
		}
		if marked {
			count++
			s.Notifier.EmployeeChanged(e.ID)
		}
	}
	return count, nil
}

func (s *Service) markActivated(ctx context.Context, e domain.Employee) (bool, error) {
	marked := false
	err := s.Store.InTx(ctx, func(tx *store.Tx) error {
		cur, err := tx.LockEmployee(ctx, e.ID)
		if errors.Is(err, domain.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if cur.ActivatedAt != nil || cur.Sub != e.Sub {
			return nil
		}
		now := s.Now()
		cur.ActivatedAt = &now
		if _, err := tx.SaveEmployee(ctx, cur); err != nil {
			return err
		}
		marked = true
		return nil
	})
	return marked, err
}
