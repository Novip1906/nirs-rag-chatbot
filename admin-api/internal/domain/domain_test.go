package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestEmployee_Status(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	past, future := now.Add(-time.Hour), now.Add(time.Hour)
	cases := []struct {
		name string
		e    Employee
		want string
	}{
		{"заблокирован важнее всего", Employee{Blocked: true, ActivatedAt: &past}, StatusBlocked},
		{"вошёл", Employee{ActivatedAt: &past}, StatusActive},
		{"ссылка жива", Employee{InviteExpiresAt: &future}, StatusInvited},
		{"ссылка истекла", Employee{InviteExpiresAt: &past}, StatusInviteExpired},
		{"без срока считается приглашённым", Employee{}, StatusInvited},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { require.Equal(t, c.want, c.e.Status(now)) })
	}
}
