package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func (s *Service) ConfirmName(ctx context.Context, actor domain.Employee, firstName, lastName string) (domain.Employee, error) {
	if !actor.Active() {
		return domain.Employee{}, domain.ErrForbidden
	}
	first, last := strings.TrimSpace(firstName), strings.TrimSpace(lastName)
	fields := map[string]string{}
	switch {
	case first == "":
		fields[domain.FieldFirstName] = "required"
	case utf8.RuneCountInString(first) > maxPersonName:
		fields[domain.FieldFirstName] = "too_long"
	}
	if utf8.RuneCountInString(last) > maxPersonName {
		fields[domain.FieldLastName] = "too_long"
	}
	if len(fields) > 0 {
		return domain.Employee{}, &domain.ValidationError{Fields: fields}
	}
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	var out domain.Employee
	err := s.Store.InTx(opCtx, func(tx *store.Tx) error {
		cur, err := tx.LockEmployee(opCtx, actor.ID)
		if err != nil {
			return err
		}
		next := cur
		next.FirstName, next.LastName = first, last
		if cur.FirstName != next.FirstName || cur.LastName != next.LastName {
			if err := s.IdP.UpdateUser(opCtx, next.Sub, idpProfile(next)); err != nil {
				return err
			}
		}
		if cur.NameConfirmedAt == nil {
			now := s.Now()
			next.NameConfirmedAt = &now
		}
		out, err = tx.SaveEmployee(opCtx, next)
		if err != nil {
			return err
		}
		return tx.InsertAudit(opCtx, &actor.ID, "employee.confirm_name", domain.TargetEmployee, cur.ID, employeeDiff(cur, next))
	})
	if err != nil {
		return domain.Employee{}, err
	}
	s.Notifier.EmployeeChanged(out.ID)
	return out, nil
}
