package httpapi

import (
	"time"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

type employeeJSON struct {
	ID              string  `json:"id"`
	Sub             string  `json:"sub"`
	Email           string  `json:"email"`
	FirstName       string  `json:"first_name"`
	LastName        string  `json:"last_name"`
	Position        string  `json:"position"`
	DepartmentID    *string `json:"department_id"`
	IsAdmin         bool    `json:"is_admin"`
	IsHead          bool    `json:"is_head"`
	Blocked         bool    `json:"blocked"`
	Status          string  `json:"status"`
	AvatarURL       *string `json:"avatar_url"`
	InvitedAt       *string `json:"invited_at"`
	InviteExpiresAt *string `json:"invite_expires_at"`
	InvitedBy       *string `json:"invited_by"`
	ActivatedAt     *string `json:"activated_at"`
	NameConfirmed   bool    `json:"name_confirmed"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
	DeletedAt       *string `json:"deleted_at"`
}

type departmentJSON struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	EmployeesCount int     `json:"employees_count"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
	DeletedAt      *string `json:"deleted_at"`
}

func formatTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func optTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := formatTime(*t)
	return &s
}

func (a *api) employee(e domain.Employee) employeeJSON {
	out := employeeJSON{
		ID: e.ID.String(), Sub: e.Sub, Email: e.Email, FirstName: e.FirstName, LastName: e.LastName,
		Position: e.Position, IsAdmin: e.IsAdmin, IsHead: e.IsHead, Blocked: e.Blocked,
		Status:    e.Status(time.Now()),
		InvitedAt: optTime(e.InvitedAt), InviteExpiresAt: optTime(e.InviteExpiresAt), ActivatedAt: optTime(e.ActivatedAt),
		NameConfirmed: e.NameConfirmedAt != nil,
		CreatedAt:     formatTime(e.CreatedAt), UpdatedAt: formatTime(e.UpdatedAt), DeletedAt: optTime(e.DeletedAt),
	}
	if e.DepartmentID != nil {
		s := e.DepartmentID.String()
		out.DepartmentID = &s
	}
	if e.InvitedBy != nil {
		s := e.InvitedBy.String()
		out.InvitedBy = &s
	}
	if e.AvatarVersion != nil {
		u := a.publicBaseURL + "/avatars/" + e.ID.String() + "/" + *e.AvatarVersion + ".jpg"
		out.AvatarURL = &u
	}
	return out
}

func (a *api) employees(in []domain.Employee) []employeeJSON {
	out := make([]employeeJSON, 0, len(in))
	for _, e := range in {
		out = append(out, a.employee(e))
	}
	return out
}

func toDepartment(d domain.Department) departmentJSON {
	return departmentJSON{
		ID: d.ID.String(), Name: d.Name, Description: d.Description, EmployeesCount: d.EmployeesCount,
		CreatedAt: formatTime(d.CreatedAt), UpdatedAt: formatTime(d.UpdatedAt), DeletedAt: optTime(d.DeletedAt),
	}
}

func toDepartments(in []domain.Department) []departmentJSON {
	out := make([]departmentJSON, 0, len(in))
	for _, d := range in {
		out = append(out, toDepartment(d))
	}
	return out
}
