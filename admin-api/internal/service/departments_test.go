package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func TestCreateDepartment_TrimsAndValidates(t *testing.T) {
	s, _, n := newService(t)
	admin := seedAdmin(t, s)
	d, err := s.CreateDepartment(context.Background(), admin, DepartmentInput{Name: ptr("  Продажи  ")})
	require.NoError(t, err)
	require.Equal(t, "Продажи", d.Name)
	require.Equal(t, []uuid.UUID{d.ID}, n.departments)

	_, err = s.CreateDepartment(context.Background(), admin, DepartmentInput{Name: ptr("   ")})
	var v *domain.ValidationError
	require.ErrorAs(t, err, &v)
	require.Equal(t, "required", v.Fields["name"])
}

func TestUpdateDepartment_NameTaken(t *testing.T) {
	s, _, _ := newService(t)
	admin := seedAdmin(t, s)
	ctx := context.Background()
	_, _ = s.CreateDepartment(ctx, admin, DepartmentInput{Name: ptr("Продажи")})
	b, _ := s.CreateDepartment(ctx, admin, DepartmentInput{Name: ptr("Юристы")})
	_, err := s.UpdateDepartment(ctx, admin, b.ID, DepartmentInput{Name: ptr("продажи")})
	require.ErrorIs(t, err, domain.ErrDepartmentNameTaken)
}

func TestDeleteDepartment_NotEmpty(t *testing.T) {
	s, _, _ := newService(t)
	admin := seedAdmin(t, s)
	ctx := context.Background()
	d, _ := s.CreateDepartment(ctx, admin, DepartmentInput{Name: ptr("Продажи")})
	_, err := s.CreateEmployee(ctx, admin, EmployeeInput{Email: ptr("a@example.com"), FirstName: ptr("А"), LastName: ptr("Б"), DepartmentID: ptr(&d.ID)})
	require.NoError(t, err)
	require.ErrorIs(t, s.DeleteDepartment(ctx, admin, d.ID), domain.ErrDepartmentNotEmpty)
}

func TestDepartment_WritesAudit(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	admin := seedAdmin(t, s)
	d, err := s.CreateDepartment(ctx, admin, DepartmentInput{Name: ptr("Продажи")})
	require.NoError(t, err)
	_, err = s.UpdateDepartment(ctx, admin, d.ID, DepartmentInput{Name: ptr("Продажи РФ")})
	require.NoError(t, err)
	require.NoError(t, s.DeleteDepartment(ctx, admin, d.ID))

	items, total, err := s.ListAudit(ctx, admin, store.AuditFilter{TargetType: domain.TargetDepartment, TargetID: &d.ID})
	require.NoError(t, err)
	require.Equal(t, 3, total)
	require.Equal(t, "department.delete", items[0].Action)
	require.Equal(t, map[string]any{"name": "Продажи РФ"}, items[0].Details)
	require.Equal(t, "department.update", items[1].Action)
	require.Equal(t, map[string]any{"name": map[string]any{"from": "Продажи", "to": "Продажи РФ"}}, items[1].Details)
	require.Equal(t, "department.create", items[2].Action)
}
