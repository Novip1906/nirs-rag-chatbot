package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

type AuditFilter struct {
	TargetType string
	TargetID   *uuid.UUID
	Limit      int
	Offset     int
}

func (t *Tx) InsertAudit(ctx context.Context, actorID *uuid.UUID, action, targetType string, targetID uuid.UUID, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	raw, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(ctx,
		`INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
		actorID, action, targetType, targetID, string(raw))
	return err
}

func (s *Store) ListAudit(ctx context.Context, f AuditFilter) ([]domain.AuditEntry, int, error) {
	var conds []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if f.TargetType != "" {
		conds = append(conds, `a.target_type = `+arg(f.TargetType))
	}
	if f.TargetID != nil {
		conds = append(conds, `a.target_id = `+arg(*f.TargetID))
	}
	where := ""
	if len(conds) > 0 {
		where = ` WHERE ` + strings.Join(conds, ` AND `)
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM audit_log a`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `SELECT a.id, a.at, a.actor_id, coalesce(e.first_name, ''), coalesce(e.last_name, ''), a.action, a.target_type, a.target_id, a.details
FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_id` + where + ` ORDER BY a.id DESC`
	if f.Limit > 0 {
		q += ` LIMIT ` + arg(f.Limit)
	}
	if f.Offset > 0 {
		q += ` OFFSET ` + arg(f.Offset)
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = rows.Close() }()
	out := []domain.AuditEntry{}
	for rows.Next() {
		var a domain.AuditEntry
		var raw []byte
		if err := rows.Scan(&a.ID, &a.At, &a.ActorID, &a.ActorFirstName, &a.ActorLastName, &a.Action, &a.TargetType, &a.TargetID, &raw); err != nil {
			return nil, 0, err
		}
		if err := json.Unmarshal(raw, &a.Details); err != nil {
			return nil, 0, err
		}
		out = append(out, a)
	}
	return out, total, rows.Err()
}
