package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

const adminLockKey int64 = 7261004001

const employeeColumns = `id, keycloak_sub, email, first_name, last_name, position, department_id, is_admin, is_head, blocked, invited_at, invite_expires_at, invited_by, activated_at, name_confirmed_at, avatar_version, created_at, updated_at, deleted_at`

type EmployeeFilter struct {
	Query        string
	DepartmentID *uuid.UUID
	NoDepartment bool
	Status       string
	Limit        int
	Offset       int
}

type rowScanner interface{ Scan(dest ...any) error }

func scanEmployee(r rowScanner) (domain.Employee, error) {
	var e domain.Employee
	err := r.Scan(&e.ID, &e.Sub, &e.Email, &e.FirstName, &e.LastName, &e.Position, &e.DepartmentID, &e.IsAdmin, &e.IsHead, &e.Blocked, &e.InvitedAt, &e.InviteExpiresAt, &e.InvitedBy, &e.ActivatedAt, &e.NameConfirmedAt, &e.AvatarVersion, &e.CreatedAt, &e.UpdatedAt, &e.DeletedAt)
	return e, err
}

func queryEmployees(ctx context.Context, q queryer, query string, args ...any) ([]domain.Employee, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []domain.Employee{}
	for rows.Next() {
		e, err := scanEmployee(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func getEmployee(ctx context.Context, q queryer, query string, args ...any) (domain.Employee, error) {
	e, err := scanEmployee(q.QueryRowContext(ctx, query, args...))
	if err != nil {
		return domain.Employee{}, mapPgError(err)
	}
	return e, nil
}

func (s *Store) EmployeeByID(ctx context.Context, id uuid.UUID) (domain.Employee, error) {
	return getEmployee(ctx, s.db, `SELECT `+employeeColumns+` FROM employees WHERE id = $1`, id)
}

func (s *Store) EmployeeBySub(ctx context.Context, sub string) (domain.Employee, error) {
	return getEmployee(ctx, s.db, `SELECT `+employeeColumns+` FROM employees WHERE keycloak_sub = $1`, sub)
}

func (s *Store) ListEmployees(ctx context.Context, f EmployeeFilter) ([]domain.Employee, int, error) {
	conds := []string{`deleted_at IS NULL`}
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if f.Query != "" {
		p := arg("%" + escapeLike(f.Query) + "%")
		conds = append(conds, fmt.Sprintf(`(first_name ILIKE %[1]s OR last_name ILIKE %[1]s OR email ILIKE %[1]s OR position ILIKE %[1]s)`, p))
	}
	if f.DepartmentID != nil {
		conds = append(conds, `department_id = `+arg(*f.DepartmentID))
	}
	if f.NoDepartment {
		conds = append(conds, `department_id IS NULL`)
	}
	switch f.Status {
	case "active":
		conds = append(conds, `NOT blocked AND activated_at IS NOT NULL`)
	case "invited":
		conds = append(conds, `NOT blocked AND activated_at IS NULL`)
	case "blocked":
		conds = append(conds, `blocked`)
	}
	where := ` WHERE ` + strings.Join(conds, ` AND `)

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM employees`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `SELECT ` + employeeColumns + ` FROM employees` + where + ` ORDER BY last_name, first_name, id`
	if f.Limit > 0 {
		q += ` LIMIT ` + arg(f.Limit)
	}
	if f.Offset > 0 {
		q += ` OFFSET ` + arg(f.Offset)
	}
	items, err := queryEmployees(ctx, s.db, q, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (s *Store) EmployeesChangedSince(ctx context.Context, since time.Time, includeDeleted bool) ([]domain.Employee, error) {
	q := `SELECT ` + employeeColumns + ` FROM employees WHERE updated_at >= $1`
	if !includeDeleted {
		q += ` AND deleted_at IS NULL`
	}
	return queryEmployees(ctx, s.db, q+` ORDER BY updated_at, id`, since)
}

func (s *Store) ActiveEmployees(ctx context.Context) ([]domain.Employee, error) {
	return queryEmployees(ctx, s.db, `SELECT `+employeeColumns+` FROM employees WHERE deleted_at IS NULL ORDER BY last_name, first_name, id`)
}

func (t *Tx) InsertEmployee(ctx context.Context, e domain.Employee) (domain.Employee, error) {
	out, err := getEmployee(ctx, t.tx, `WITH c AS (SELECT clock_timestamp() AS t)
INSERT INTO employees (id, keycloak_sub, email, first_name, last_name, position, department_id, is_admin, is_head, blocked,
invited_at, invite_expires_at, invited_by, activated_at, name_confirmed_at, created_at, updated_at)
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, c.t, c.t FROM c RETURNING `+employeeColumns,
		e.ID, e.Sub, e.Email, e.FirstName, e.LastName, e.Position, e.DepartmentID, e.IsAdmin, e.IsHead, e.Blocked,
		e.InvitedAt, e.InviteExpiresAt, e.InvitedBy, e.ActivatedAt, e.NameConfirmedAt)
	if err != nil {
		return domain.Employee{}, err
	}
	return out, nil
}

func (t *Tx) LockEmployee(ctx context.Context, id uuid.UUID) (domain.Employee, error) {
	return getEmployee(ctx, t.tx, `SELECT `+employeeColumns+` FROM employees WHERE id = $1 AND deleted_at IS NULL FOR NO KEY UPDATE`, id)
}

func (t *Tx) SaveEmployee(ctx context.Context, e domain.Employee) (domain.Employee, error) {
	return getEmployee(ctx, t.tx, `UPDATE employees SET keycloak_sub = $2, email = $3, first_name = $4, last_name = $5, position = $6,
department_id = $7, is_admin = $8, is_head = $9, blocked = $10, invited_at = $11, invite_expires_at = $12, invited_by = $13,
activated_at = $14, name_confirmed_at = $15, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL RETURNING `+employeeColumns,
		e.ID, e.Sub, e.Email, e.FirstName, e.LastName, e.Position, e.DepartmentID, e.IsAdmin, e.IsHead, e.Blocked,
		e.InvitedAt, e.InviteExpiresAt, e.InvitedBy, e.ActivatedAt, e.NameConfirmedAt)
}

func (t *Tx) SoftDeleteEmployee(ctx context.Context, id uuid.UUID) error {
	res, err := t.tx.ExecContext(ctx, `UPDATE employees SET deleted_at = c.t, updated_at = c.t FROM (SELECT clock_timestamp() AS t) c WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (t *Tx) LockAdmins(ctx context.Context) error {
	_, err := t.tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, adminLockKey)
	return err
}

func (t *Tx) CountActiveAdmins(ctx context.Context) (int, error) {
	var n int
	err := t.tx.QueryRowContext(ctx, `SELECT count(*) FROM employees WHERE is_admin AND NOT blocked AND activated_at IS NOT NULL AND deleted_at IS NULL`).Scan(&n)
	return n, err
}

func (s *Store) EmailTaken(ctx context.Context, email string) (bool, error) {
	var taken bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM employees WHERE email = $1 AND deleted_at IS NULL)`, email).Scan(&taken)
	return taken, err
}

func (s *Store) EmailTakenByOther(ctx context.Context, email string, id uuid.UUID) (bool, error) {
	var taken bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM employees WHERE email = $1 AND id <> $2 AND deleted_at IS NULL)`, email, id).Scan(&taken)
	return taken, err
}

func (s *Store) PendingEmployees(ctx context.Context) ([]domain.Employee, error) {
	return queryEmployees(ctx, s.db, `SELECT `+employeeColumns+` FROM employees WHERE activated_at IS NULL AND deleted_at IS NULL ORDER BY created_at, id`)
}
