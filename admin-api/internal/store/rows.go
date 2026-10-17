package store

import "context"

func (t *Tx) HasRows(ctx context.Context) (bool, error) {
	var has bool
	err := t.tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM employees) OR EXISTS (SELECT 1 FROM departments)`).Scan(&has)
	return has, err
}
