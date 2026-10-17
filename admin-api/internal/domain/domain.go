package domain

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Employee struct {
	ID              uuid.UUID
	Sub             string
	Email           string
	FirstName       string
	LastName        string
	Position        string
	DepartmentID    *uuid.UUID
	IsAdmin         bool
	IsHead          bool
	Blocked         bool
	InvitedAt       *time.Time
	InviteExpiresAt *time.Time
	InvitedBy       *uuid.UUID
	ActivatedAt     *time.Time
	NameConfirmedAt *time.Time
	AvatarVersion   *string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       *time.Time
}

type AuditEntry struct {
	ID             int64
	At             time.Time
	ActorID        *uuid.UUID
	ActorFirstName string
	ActorLastName  string
	Action         string
	TargetType     string
	TargetID       uuid.UUID
	Details        map[string]any
}

const (
	TargetEmployee   = "employee"
	TargetDepartment = "department"
)

const (
	StatusInvited       = "invited"
	StatusInviteExpired = "invite_expired"
	StatusActive        = "active"
	StatusBlocked       = "blocked"
)

func (e Employee) Status(now time.Time) string {
	switch {
	case e.Blocked:
		return StatusBlocked
	case e.ActivatedAt != nil:
		return StatusActive
	case e.InviteExpiresAt != nil && now.After(*e.InviteExpiresAt):
		return StatusInviteExpired
	}
	return StatusInvited
}

type Department struct {
	ID             uuid.UUID
	Name           string
	Description    string
	EmployeesCount int
	CreatedAt      time.Time
	UpdatedAt      time.Time
	DeletedAt      *time.Time
}

var (
	ErrNotFound            = errors.New("not found")
	ErrEmailTaken          = errors.New("email taken")
	ErrDepartmentNameTaken = errors.New("department name taken")
	ErrDepartmentNotEmpty  = errors.New("department not empty")
	ErrLastAdmin           = errors.New("last admin")
	ErrSelfAdminRevoke     = errors.New("self admin revoke")
	ErrSelfBlock           = errors.New("self block")
	ErrSelfDelete          = errors.New("self delete")
	ErrIdPUnavailable      = errors.New("idp unavailable")
	ErrIdPRejected         = errors.New("idp rejected")
	ErrIdPAccountMissing   = errors.New("idp account missing")
	ErrForbidden           = errors.New("forbidden")
	ErrReinviteRequired    = errors.New("reinvite required")
	ErrAlreadyActive       = errors.New("already active")
	ErrNotActivated        = errors.New("not activated")
)

const (
	FieldEmail      = "email"
	FieldFirstName  = "first_name"
	FieldLastName   = "last_name"
	FieldPosition   = "position"
	FieldDepartment = "department_id"
	FieldIsAdmin    = "is_admin"
	FieldIsHead     = "is_head"
	FieldBlocked    = "blocked"
)

type ValidationError struct{ Fields map[string]string }

func (e *ValidationError) Error() string {
	keys := make([]string, 0, len(e.Fields))
	for k := range e.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s: %s", k, e.Fields[k]))
	}
	return "validation failed: " + strings.Join(parts, "; ")
}
