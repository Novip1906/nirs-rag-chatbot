package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

type IdP interface {
	CreateInvited(ctx context.Context, employeeID string, p keycloak.Profile) (string, error)
	MagicLink(ctx context.Context, sub, email string, ttl time.Duration) (keycloak.InviteLink, error)
	HasPassword(ctx context.Context, sub string) (bool, error)
	FindByEmail(ctx context.Context, email string) (keycloak.User, bool, error)
	UpdateUser(ctx context.Context, sub string, p keycloak.Profile) error
	SetPassword(ctx context.Context, sub, temporaryPassword string) error
	Logout(ctx context.Context, sub string) error
	DeleteUser(ctx context.Context, sub string) error
}

type Notifier interface {
	EmployeeChanged(id uuid.UUID)
	DepartmentChanged(id uuid.UUID)
}

type Service struct {
	Store       *store.Store
	IdP         IdP
	Notifier    Notifier
	NewPassword func() string
	Now         func() time.Time
	NewToken    func() string
	InviteTTL   time.Duration
}
