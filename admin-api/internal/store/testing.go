package store

import "context"

func (s *Store) TruncateForTests(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `TRUNCATE employees, departments, employee_avatars, audit_log`)
	return err
}
