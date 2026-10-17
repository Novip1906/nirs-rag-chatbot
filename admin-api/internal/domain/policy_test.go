package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestEditableFields(t *testing.T) {
	sales, legal := uuid.New(), uuid.New()
	now := time.Now()
	target := Employee{ID: uuid.New(), DepartmentID: &sales}
	all := []string{FieldEmail, FieldFirstName, FieldLastName, FieldPosition, FieldDepartment, FieldIsAdmin, FieldIsHead, FieldBlocked}
	cases := []struct {
		name  string
		actor Employee
		want  []string
	}{
		{"админ правит всё", Employee{IsAdmin: true}, all},
		{"руководитель своего отдела — только должность", Employee{IsHead: true, DepartmentID: &sales}, []string{FieldPosition}},
		{"руководитель чужого отдела — ничего", Employee{IsHead: true, DepartmentID: &legal}, nil},
		{"руководитель без отдела — ничего", Employee{IsHead: true}, nil},
		{"заблокированный админ — ничего", Employee{IsAdmin: true, Blocked: true}, nil},
		{"удалённый руководитель — ничего", Employee{IsHead: true, DepartmentID: &sales, DeletedAt: &now}, nil},
		{"обычный сотрудник — ничего", Employee{DepartmentID: &sales}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := EditableFields(c.actor, target)
			require.Len(t, got, len(c.want))
			for _, f := range c.want {
				require.True(t, got[f], f)
			}
		})
	}
}

func TestCanDelete_HeadOnlyNotActivated(t *testing.T) {
	sales := uuid.New()
	now := time.Now()
	head := Employee{IsHead: true, DepartmentID: &sales}
	require.True(t, CanDelete(head, Employee{DepartmentID: &sales}))
	require.False(t, CanDelete(head, Employee{DepartmentID: &sales, ActivatedAt: &now}))
	require.True(t, CanDelete(Employee{IsAdmin: true}, Employee{DepartmentID: &sales, ActivatedAt: &now}))
	require.False(t, CanDelete(head, Employee{DepartmentID: &sales, IsAdmin: true}))
	require.False(t, CanDelete(head, Employee{DepartmentID: &sales, IsHead: true}))
	require.True(t, CanDelete(Employee{IsAdmin: true}, Employee{DepartmentID: &sales, IsAdmin: true, IsHead: true}))
}

func TestCanReinvite_HeadNotPrivileged(t *testing.T) {
	sales, legal := uuid.New(), uuid.New()
	head := Employee{IsHead: true, DepartmentID: &sales}
	admin := Employee{IsAdmin: true}
	require.True(t, CanReinvite(head, Employee{DepartmentID: &sales}))
	require.False(t, CanReinvite(head, Employee{DepartmentID: &legal}))
	require.False(t, CanReinvite(head, Employee{DepartmentID: &sales, IsAdmin: true}))
	require.False(t, CanReinvite(head, Employee{DepartmentID: &sales, IsHead: true}))
	require.False(t, CanReinvite(head, Employee{DepartmentID: &sales, IsAdmin: true, Blocked: true}))
	require.True(t, CanReinvite(admin, Employee{DepartmentID: &sales, IsAdmin: true}))
	require.True(t, CanReinvite(admin, Employee{IsHead: true, DepartmentID: &legal}))
	require.False(t, CanReinvite(Employee{DepartmentID: &sales}, Employee{DepartmentID: &sales}))
}

func TestCanInvite(t *testing.T) {
	sales, legal := uuid.New(), uuid.New()
	head := Employee{IsHead: true, DepartmentID: &sales}
	require.True(t, CanInvite(head, &sales))
	require.False(t, CanInvite(head, &legal))
	require.False(t, CanInvite(head, nil))
	require.True(t, CanInvite(Employee{IsAdmin: true}, nil))
}

func TestCanView(t *testing.T) {
	sales, legal := uuid.New(), uuid.New()
	head := Employee{IsHead: true, DepartmentID: &sales}
	require.True(t, CanView(head, Employee{DepartmentID: &sales}))
	require.False(t, CanView(head, Employee{DepartmentID: &legal}))
	require.False(t, CanView(head, Employee{}))
	require.True(t, CanView(Employee{IsAdmin: true}, Employee{}))
	require.False(t, CanView(Employee{}, Employee{}))
}
