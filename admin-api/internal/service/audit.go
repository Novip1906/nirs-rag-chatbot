package service

import (
	"context"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func employeeDiff(cur, next domain.Employee) map[string]any {
	out := map[string]any{}
	add := func(field string, from, to any) {
		if from != to {
			out[field] = map[string]any{"from": from, "to": to}
		}
	}
	dep := func(e domain.Employee) any {
		if e.DepartmentID == nil {
			return nil
		}
		return e.DepartmentID.String()
	}
	add(domain.FieldEmail, cur.Email, next.Email)
	add(domain.FieldFirstName, cur.FirstName, next.FirstName)
	add(domain.FieldLastName, cur.LastName, next.LastName)
	add(domain.FieldPosition, cur.Position, next.Position)
	add(domain.FieldDepartment, dep(cur), dep(next))
	add(domain.FieldIsAdmin, cur.IsAdmin, next.IsAdmin)
	add(domain.FieldIsHead, cur.IsHead, next.IsHead)
	add(domain.FieldBlocked, cur.Blocked, next.Blocked)
	return out
}

func departmentDiff(cur, next domain.Department) map[string]any {
	out := map[string]any{}
	if cur.Name != next.Name {
		out["name"] = map[string]any{"from": cur.Name, "to": next.Name}
	}
	if cur.Description != next.Description {
		out["description"] = map[string]any{"from": cur.Description, "to": next.Description}
	}
	return out
}

func (s *Service) ListAudit(ctx context.Context, actor domain.Employee, f store.AuditFilter) ([]domain.AuditEntry, int, error) {
	if !actor.Admin() {
		return nil, 0, domain.ErrForbidden
	}
	return s.Store.ListAudit(ctx, f)
}
