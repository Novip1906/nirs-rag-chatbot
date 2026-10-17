package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

const (
	maxDepartmentName        = 120
	maxDepartmentDescription = 500
)

type DepartmentInput struct {
	Name        *string
	Description *string
}

func applyDepartmentInput(cur domain.Department, in DepartmentInput) (domain.Department, error) {
	fields := map[string]string{}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		switch {
		case name == "":
			fields["name"] = "required"
		case utf8.RuneCountInString(name) > maxDepartmentName:
			fields["name"] = "too_long"
		default:
			cur.Name = name
		}
	}
	if in.Description != nil {
		desc := strings.TrimSpace(*in.Description)
		if utf8.RuneCountInString(desc) > maxDepartmentDescription {
			fields["description"] = "too_long"
		} else {
			cur.Description = desc
		}
	}
	if len(fields) > 0 {
		return domain.Department{}, &domain.ValidationError{Fields: fields}
	}
	return cur, nil
}

func (s *Service) CreateDepartment(ctx context.Context, actor domain.Employee, in DepartmentInput) (domain.Department, error) {
	if !actor.Admin() {
		return domain.Department{}, domain.ErrForbidden
	}
	if in.Name == nil {
		return domain.Department{}, &domain.ValidationError{Fields: map[string]string{"name": "required"}}
	}
	d, err := applyDepartmentInput(domain.Department{ID: uuid.New()}, in)
	if err != nil {
		return domain.Department{}, err
	}
	var out domain.Department
	err = s.Store.InTx(ctx, func(tx *store.Tx) error {
		var err error
		out, err = tx.InsertDepartment(ctx, d)
		if err != nil {
			return err
		}
		return tx.InsertAudit(ctx, &actor.ID, "department.create", domain.TargetDepartment, out.ID, map[string]any{"name": out.Name})
	})
	if err != nil {
		return domain.Department{}, err
	}
	s.Notifier.DepartmentChanged(out.ID)
	return out, nil
}

func (s *Service) UpdateDepartment(ctx context.Context, actor domain.Employee, id uuid.UUID, in DepartmentInput) (domain.Department, error) {
	if !actor.Admin() {
		return domain.Department{}, domain.ErrForbidden
	}
	var out domain.Department
	err := s.Store.InTx(ctx, func(tx *store.Tx) error {
		cur, err := tx.LockDepartment(ctx, id)
		if err != nil {
			return err
		}
		next, err := applyDepartmentInput(cur, in)
		if err != nil {
			return err
		}
		out, err = tx.SaveDepartment(ctx, next)
		if err != nil {
			return err
		}
		diff := departmentDiff(cur, out)
		if len(diff) == 0 {
			return nil
		}
		return tx.InsertAudit(ctx, &actor.ID, "department.update", domain.TargetDepartment, out.ID, diff)
	})
	if err != nil {
		return domain.Department{}, err
	}
	s.Notifier.DepartmentChanged(out.ID)
	return out, nil
}

func (s *Service) DeleteDepartment(ctx context.Context, actor domain.Employee, id uuid.UUID) error {
	if !actor.Admin() {
		return domain.ErrForbidden
	}
	err := s.Store.InTx(ctx, func(tx *store.Tx) error {
		cur, err := tx.LockDepartment(ctx, id)
		if err != nil {
			return err
		}
		n, err := tx.CountDepartmentMembers(ctx, id)
		if err != nil {
			return err
		}
		if n > 0 {
			return domain.ErrDepartmentNotEmpty
		}
		if err := tx.SoftDeleteDepartment(ctx, id); err != nil {
			return err
		}
		return tx.InsertAudit(ctx, &actor.ID, "department.delete", domain.TargetDepartment, id, map[string]any{"name": cur.Name})
	})
	if err != nil {
		return err
	}
	s.Notifier.DepartmentChanged(id)
	return nil
}
