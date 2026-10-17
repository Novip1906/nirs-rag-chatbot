package service

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func TestConfirmName_Repeatable(t *testing.T) {
	s, idp, n := newService(t)
	ctx := context.Background()
	me := seed(t, s, func(e *domain.Employee) { e.FirstName, e.LastName = "Ксения Финансы", "" })

	out, err := s.ConfirmName(ctx, me, " Ксения ", "Ли")
	require.NoError(t, err)
	require.Equal(t, "Ксения", out.FirstName)
	require.Equal(t, "Ли", out.LastName)
	require.NotNil(t, out.NameConfirmedAt)
	require.Contains(t, idp.calls, "update:"+me.Sub+":enabled=true")
	require.Contains(t, n.employees, me.ID)

	again, err := s.ConfirmName(ctx, out, "Другое", "")
	require.NoError(t, err)
	require.Equal(t, "Другое", again.FirstName)
	require.Equal(t, "", again.LastName)
	require.True(t, out.NameConfirmedAt.Equal(*again.NameConfirmedAt))
}

func TestConfirmName_UnchangedStillConfirms(t *testing.T) {
	s, idp, _ := newService(t)
	me := seed(t, s, func(e *domain.Employee) { e.FirstName = "Анна" })
	out, err := s.ConfirmName(context.Background(), me, "Анна", "")
	require.NoError(t, err)
	require.NotNil(t, out.NameConfirmedAt)
	require.Empty(t, idp.calls)
}

func TestConfirmName_Validation(t *testing.T) {
	s, idp, _ := newService(t)
	me := seed(t, s, nil)
	_, err := s.ConfirmName(context.Background(), me, "  ", "Ли")
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	require.Equal(t, "required", v.Fields["first_name"])
	require.Empty(t, idp.calls)
	got, err := s.Store.EmployeeByID(context.Background(), me.ID)
	require.NoError(t, err)
	require.Nil(t, got.NameConfirmedAt)
}

func TestConfirmName_IdPFailureKeepsUnconfirmed(t *testing.T) {
	s, idp, _ := newService(t)
	me := seed(t, s, nil)
	idp.err = domain.ErrIdPUnavailable
	_, err := s.ConfirmName(context.Background(), me, "Новое", "")
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
	got, err := s.Store.EmployeeByID(context.Background(), me.ID)
	require.NoError(t, err)
	require.Nil(t, got.NameConfirmedAt)
	require.Equal(t, "Тест", got.FirstName)
}

func TestConfirmName_BlockedForbidden(t *testing.T) {
	s, _, _ := newService(t)
	me := seed(t, s, func(e *domain.Employee) { e.Blocked = true })
	_, err := s.ConfirmName(context.Background(), me, "Анна", "")
	require.ErrorIs(t, err, domain.ErrForbidden)
}

func TestConfirmName_WritesAudit(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	me := seed(t, s, nil)
	_, err := s.ConfirmName(ctx, me, "Анна", "Ли")
	require.NoError(t, err)
	items, total, err := s.Store.ListAudit(ctx, auditFor(me.ID))
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "employee.confirm_name", items[0].Action)
	require.Equal(t, map[string]any{
		"first_name": map[string]any{"from": "Тест", "to": "Анна"},
		"last_name":  map[string]any{"from": "", "to": "Ли"},
	}, items[0].Details)
}

func TestAvatar_SetReplaceRemove(t *testing.T) {
	s, _, n := newService(t)
	ctx := context.Background()
	admin := seed(t, s, func(e *domain.Employee) { e.IsAdmin = true })
	me := seed(t, s, nil)
	other := seed(t, s, nil)
	var buf bytes.Buffer
	require.NoError(t, jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 10, 10)), nil))

	first, err := s.SetOwnAvatar(ctx, me, buf.Bytes())
	require.NoError(t, err)
	second, err := s.SetOwnAvatar(ctx, me, buf.Bytes())
	require.NoError(t, err)
	require.NotEqual(t, *first.AvatarVersion, *second.AvatarVersion)
	_, err = s.Store.Avatar(ctx, me.ID, *first.AvatarVersion)
	require.ErrorIs(t, err, domain.ErrNotFound)
	_, err = s.Store.Avatar(ctx, me.ID, *second.AvatarVersion)
	require.NoError(t, err)
	require.Contains(t, n.employees, me.ID)

	_, err = s.RemoveAvatar(ctx, other, me.ID)
	require.ErrorIs(t, err, domain.ErrForbidden)
	removed, err := s.RemoveAvatar(ctx, admin, me.ID)
	require.NoError(t, err)
	require.Nil(t, removed.AvatarVersion)
	items, total, err := s.Store.ListAudit(ctx, auditFor(me.ID))
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "employee.avatar_remove", items[0].Action)
	require.Equal(t, admin.ID, *items[0].ActorID)

	_, err = s.SetOwnAvatar(ctx, me, buf.Bytes())
	require.NoError(t, err)
	_, err = s.RemoveAvatar(ctx, me, me.ID)
	require.NoError(t, err)
	_, total, err = s.Store.ListAudit(ctx, auditFor(me.ID))
	require.NoError(t, err)
	require.Equal(t, 1, total)
}

func TestAvatar_RejectsGarbageAndBlocked(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	me := seed(t, s, nil)
	_, err := s.SetOwnAvatar(ctx, me, []byte("не картинка"))
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	require.Equal(t, "invalid", v.Fields["avatar"])
	_, err = s.SetOwnAvatar(ctx, me, make([]byte, 5<<20+1))
	require.ErrorAs(t, err, &v)
	require.Equal(t, "too_large", v.Fields["avatar"])

	blocked := seed(t, s, func(e *domain.Employee) { e.Blocked = true })
	_, err = s.SetOwnAvatar(ctx, blocked, []byte("x"))
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, err = s.RemoveAvatar(ctx, blocked, blocked.ID)
	require.ErrorIs(t, err, domain.ErrForbidden)
}
