package store

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

const departmentColumns = `d.id, d.name, d.description, (SELECT count(*) FROM employees e WHERE e.department_id = d.id AND e.deleted_at IS NULL), d.created_at, d.updated_at, d.deleted_at`

func scanDepartment(r rowScanner) (domain.Department, error) {
	var d domain.Department
	err := r.Scan(&d.ID, &d.Name, &d.Description, &d.EmployeesCount, &d.CreatedAt, &d.UpdatedAt, &d.DeletedAt)
	return d, err
}

func queryDepartments(ctx context.Context, q queryer, query string, args ...any) ([]domain.Department, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []domain.Department{}
	for rows.Next() {
		d, err := scanDepartment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func getDepartment(ctx context.Context, q queryer, query string, args ...any) (domain.Department, error) {
	d, err := scanDepartment(q.QueryRowContext(ctx, query, args...))
	if err != nil {
		return domain.Department{}, mapPgError(err)
	}
	return d, nil
}

func (s *Store) DepartmentByID(ctx context.Context, id uuid.UUID) (domain.Department, error) {
	return getDepartment(ctx, s.db, `SELECT `+departmentColumns+` FROM departments d WHERE d.id = $1 AND d.deleted_at IS NULL`, id)
}

func (s *Store) ListDepartments(ctx context.Context) ([]domain.Department, error) {
	return queryDepartments(ctx, s.db, `SELECT `+departmentColumns+` FROM departments d WHERE d.deleted_at IS NULL ORDER BY lower(d.name), d.id`)
}

func (s *Store) DepartmentsChangedSince(ctx context.Context, since time.Time, includeDeleted bool) ([]domain.Department, error) {
	q := `SELECT ` + departmentColumns + ` FROM departments d WHERE d.updated_at >= $1`
	if !includeDeleted {
		q += ` AND d.deleted_at IS NULL`
	}
	return queryDepartments(ctx, s.db, q+` ORDER BY d.updated_at, d.id`, since)
}

func (t *Tx) InsertDepartment(ctx context.Context, d domain.Department) (domain.Department, error) {
	_, err := t.tx.ExecContext(ctx, `WITH c AS (SELECT clock_timestamp() AS t) INSERT INTO departments (id, name, description, created_at, updated_at) SELECT $1, $2, $3, c.t, c.t FROM c`, d.ID, d.Name, d.Description)
	if err != nil {
		return domain.Department{}, mapPgError(err)
	}
	return getDepartment(ctx, t.tx, `SELECT `+departmentColumns+` FROM departments d WHERE d.id = $1`, d.ID)
}

func (t *Tx) LockDepartment(ctx context.Context, id uuid.UUID) (domain.Department, error) {
	var lockedID uuid.UUID
	if err := t.tx.QueryRowContext(ctx, `SELECT id FROM departments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&lockedID); err != nil {
		return domain.Department{}, mapPgError(err)
	}
	return getDepartment(ctx, t.tx, `SELECT `+departmentColumns+` FROM departments d WHERE d.id = $1`, id)
}

func (t *Tx) DepartmentForShare(ctx context.Context, id uuid.UUID) error {
	var found uuid.UUID
	if err := t.tx.QueryRowContext(ctx, `SELECT id FROM departments WHERE id = $1 AND deleted_at IS NULL FOR SHARE`, id).Scan(&found); err != nil {
		return mapPgError(err)
	}
	return nil
}

func (t *Tx) SaveDepartment(ctx context.Context, d domain.Department) (domain.Department, error) {
	res, err := t.tx.ExecContext(ctx, `UPDATE departments SET name = $2, description = $3, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL`, d.ID, d.Name, d.Description)
	if err != nil {
		return domain.Department{}, mapPgError(err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.Department{}, domain.ErrNotFound
	}
	return getDepartment(ctx, t.tx, `SELECT `+departmentColumns+` FROM departments d WHERE d.id = $1`, d.ID)
}

func (t *Tx) SoftDeleteDepartment(ctx context.Context, id uuid.UUID) error {
	res, err := t.tx.ExecContext(ctx, `UPDATE departments SET deleted_at = c.t, updated_at = c.t FROM (SELECT clock_timestamp() AS t) c WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (t *Tx) CountDepartmentMembers(ctx context.Context, id uuid.UUID) (int, error) {
	var n int
	err := t.tx.QueryRowContext(ctx, `SELECT count(*) FROM employees WHERE department_id = $1 AND deleted_at IS NULL`, id).Scan(&n)
	return n, err
}
