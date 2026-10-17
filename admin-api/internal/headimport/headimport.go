package headimport

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

type Entry struct {
	EmployeeID string `json:"employee_id"`
}

type Report struct {
	Set          []string `json:"set"`
	AlreadySet   []string `json:"already_set"`
	NoDepartment []string `json:"no_department"`
	NotFound     []string `json:"not_found"`
}

func Run(ctx context.Context, s *store.Store, entries []Entry, apply bool) (Report, error) {
	report := Report{Set: []string{}, AlreadySet: []string{}, NoDepartment: []string{}, NotFound: []string{}}
	seen := map[uuid.UUID]bool{}
	for _, entry := range entries {
		id, err := uuid.Parse(entry.EmployeeID)
		if err != nil {
			report.NotFound = append(report.NotFound, entry.EmployeeID)
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		e, err := s.EmployeeByID(ctx, id)
		if errors.Is(err, domain.ErrNotFound) || (err == nil && e.DeletedAt != nil) {
			report.NotFound = append(report.NotFound, entry.EmployeeID)
			continue
		}
		if err != nil {
			return report, err
		}
		switch {
		case e.DepartmentID == nil:
			report.NoDepartment = append(report.NoDepartment, id.String())
		case e.IsHead:
			report.AlreadySet = append(report.AlreadySet, id.String())
		default:
			report.Set = append(report.Set, id.String())
			if apply {
				if err := setHead(ctx, s, id); err != nil {
					return report, err
				}
			}
		}
	}
	return report, nil
}

func setHead(ctx context.Context, s *store.Store, id uuid.UUID) error {
	return s.InTx(ctx, func(tx *store.Tx) error {
		cur, err := tx.LockEmployee(ctx, id)
		if err != nil {
			return err
		}
		if cur.DepartmentID == nil || cur.IsHead {
			return nil
		}
		next := cur
		next.IsHead = true
		if _, err := tx.SaveEmployee(ctx, next); err != nil {
			return err
		}
		return tx.InsertAudit(ctx, nil, "employee.update", domain.TargetEmployee, id,
			map[string]any{"is_head": map[string]any{"from": false, "to": true}})
	})
}
