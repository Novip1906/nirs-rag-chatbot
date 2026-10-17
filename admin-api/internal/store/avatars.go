package store

import (
	"context"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func (t *Tx) PutAvatar(ctx context.Context, id uuid.UUID, content []byte, version string) (domain.Employee, error) {
	if _, err := t.tx.ExecContext(ctx,
		`INSERT INTO employee_avatars (employee_id, content, updated_at) VALUES ($1, $2, now())
ON CONFLICT (employee_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`, id, content); err != nil {
		return domain.Employee{}, err
	}
	return getEmployee(ctx, t.tx, `UPDATE employees SET avatar_version = $2, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL RETURNING `+employeeColumns, id, version)
}

func (t *Tx) RemoveAvatar(ctx context.Context, id uuid.UUID) (domain.Employee, error) {
	if _, err := t.tx.ExecContext(ctx, `DELETE FROM employee_avatars WHERE employee_id = $1`, id); err != nil {
		return domain.Employee{}, err
	}
	return getEmployee(ctx, t.tx, `UPDATE employees SET avatar_version = NULL, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL RETURNING `+employeeColumns, id)
}

func (s *Store) Avatar(ctx context.Context, id uuid.UUID, version string) ([]byte, error) {
	var content []byte
	err := s.db.QueryRowContext(ctx,
		`SELECT a.content FROM employee_avatars a JOIN employees e ON e.id = a.employee_id
WHERE e.id = $1 AND e.avatar_version = $2 AND e.deleted_at IS NULL`, id, version).Scan(&content)
	if err != nil {
		return nil, mapPgError(err)
	}
	return content, nil
}
