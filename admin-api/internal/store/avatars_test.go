package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func TestAvatars_PutReplaceRemove(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	e := mustEmployee(t, s, "a@example.com", nil)

	var first domain.Employee
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		var err error
		first, err = tx.PutAvatar(ctx, e.ID, []byte("one"), "v1")
		return err
	}))
	require.Equal(t, "v1", *first.AvatarVersion)
	require.True(t, first.UpdatedAt.After(e.UpdatedAt))
	got, err := s.Avatar(ctx, e.ID, "v1")
	require.NoError(t, err)
	require.Equal(t, []byte("one"), got)

	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		_, err := tx.PutAvatar(ctx, e.ID, []byte("two"), "v2")
		return err
	}))
	_, err = s.Avatar(ctx, e.ID, "v1")
	require.ErrorIs(t, err, domain.ErrNotFound)
	got, err = s.Avatar(ctx, e.ID, "v2")
	require.NoError(t, err)
	require.Equal(t, []byte("two"), got)
	_, err = s.Avatar(ctx, uuid.New(), "v2")
	require.ErrorIs(t, err, domain.ErrNotFound)

	var removed domain.Employee
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		var err error
		removed, err = tx.RemoveAvatar(ctx, e.ID)
		return err
	}))
	require.Nil(t, removed.AvatarVersion)
	_, err = s.Avatar(ctx, e.ID, "v2")
	require.ErrorIs(t, err, domain.ErrNotFound)
}

func TestAvatars_HiddenAfterSoftDelete(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	e := mustEmployee(t, s, "a@example.com", nil)
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error {
		_, err := tx.PutAvatar(ctx, e.ID, []byte("one"), "v1")
		return err
	}))
	require.NoError(t, s.InTx(ctx, func(tx *Tx) error { return tx.SoftDeleteEmployee(ctx, e.ID) }))
	_, err := s.Avatar(ctx, e.ID, "v1")
	require.ErrorIs(t, err, domain.ErrNotFound)
	err = s.InTx(ctx, func(tx *Tx) error {
		_, err := tx.PutAvatar(ctx, e.ID, []byte("two"), "v2")
		return err
	})
	require.ErrorIs(t, err, domain.ErrNotFound)
}
