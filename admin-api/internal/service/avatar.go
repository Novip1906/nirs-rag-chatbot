package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/imageproc"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func GenerateToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (s *Service) SetOwnAvatar(ctx context.Context, actor domain.Employee, raw []byte) (domain.Employee, error) {
	if !actor.Active() {
		return domain.Employee{}, domain.ErrForbidden
	}
	content, err := imageproc.Normalize(ctx, raw)
	switch {
	case errors.Is(err, imageproc.ErrTooLarge):
		return domain.Employee{}, &domain.ValidationError{Fields: map[string]string{"avatar": "too_large"}}
	case errors.Is(err, imageproc.ErrInvalid):
		return domain.Employee{}, &domain.ValidationError{Fields: map[string]string{"avatar": "invalid"}}
	case err != nil:
		return domain.Employee{}, err
	}
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	var out domain.Employee
	err = s.Store.InTx(opCtx, func(tx *store.Tx) error {
		var err error
		out, err = tx.PutAvatar(opCtx, actor.ID, content, s.NewToken())
		return err
	})
	if err != nil {
		return domain.Employee{}, err
	}
	s.Notifier.EmployeeChanged(out.ID)
	return out, nil
}

func (s *Service) RemoveAvatar(ctx context.Context, actor domain.Employee, id uuid.UUID) (domain.Employee, error) {
	own := actor.ID == id
	switch {
	case own && actor.Active():
	case actor.Admin():
	default:
		return domain.Employee{}, domain.ErrForbidden
	}
	opCtx, cancel := detached(ctx, operationTimeout)
	defer cancel()
	var out domain.Employee
	err := s.Store.InTx(opCtx, func(tx *store.Tx) error {
		var err error
		out, err = tx.RemoveAvatar(opCtx, id)
		if err != nil {
			return err
		}
		if own {
			return nil
		}
		return tx.InsertAudit(opCtx, &actor.ID, "employee.avatar_remove", domain.TargetEmployee, id, nil)
	})
	if err != nil {
		return domain.Employee{}, err
	}
	s.Notifier.EmployeeChanged(out.ID)
	return out, nil
}
