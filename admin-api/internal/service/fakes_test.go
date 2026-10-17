package service

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

type fakeIdP struct {
	mu           sync.Mutex
	err          error
	deleteErr    error
	failCreate   error
	linkErr      error
	calls        []string
	delay        time.Duration
	onCreate     func()
	deleteCtxErr error
	updateCtxErr error
	accounts     map[string]bool
	byEmail      map[string]string
	owners       map[string]string
	passwordErr  map[string]error
	onPassword   func(sub string) *bool
	counter      int
}

func (f *fakeIdP) record(call string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, call)
}

func (f *fakeIdP) CreateInvited(_ context.Context, id string, p keycloak.Profile) (string, error) {
	f.record("create")
	if f.onCreate != nil {
		f.onCreate()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return "", f.err
	}
	if f.failCreate != nil {
		return "", f.failCreate
	}
	if _, taken := f.byEmail[p.Email]; taken {
		return "", domain.ErrEmailTaken
	}
	f.counter++
	sub := fmt.Sprintf("sub-%s-%d", id, f.counter)
	f.accounts[sub] = false
	f.byEmail[p.Email] = sub
	f.owners[sub] = id
	return sub, nil
}

func (f *fakeIdP) MagicLink(_ context.Context, sub, _ string, _ time.Duration) (keycloak.InviteLink, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.linkErr != nil {
		return keycloak.InviteLink{}, f.linkErr
	}
	return keycloak.InviteLink{Link: "https://auth.test/link/" + sub, Sent: true}, nil
}

func (f *fakeIdP) HasPassword(_ context.Context, sub string) (bool, error) {
	if f.onPassword != nil {
		if forced := f.onPassword(sub); forced != nil {
			return *forced, nil
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return false, f.err
	}
	if err := f.passwordErr[sub]; err != nil {
		return false, err
	}
	has, ok := f.accounts[sub]
	if !ok {
		return false, domain.ErrIdPAccountMissing
	}
	return has, nil
}

func (f *fakeIdP) FindByEmail(_ context.Context, email string) (keycloak.User, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	sub, ok := f.byEmail[email]
	return keycloak.User{ID: sub, Email: email, EmployeeID: f.owners[sub]}, ok, f.err
}

func (f *fakeIdP) UpdateUser(ctx context.Context, sub string, p keycloak.Profile) error {
	f.record(fmt.Sprintf("update:%s:enabled=%t", sub, p.Enabled))
	f.mu.Lock()
	f.updateCtxErr = ctx.Err()
	f.mu.Unlock()
	time.Sleep(f.delay)
	return f.err
}

func (f *fakeIdP) SetPassword(context.Context, string, string) error {
	f.record("password")
	return f.err
}

func (f *fakeIdP) Logout(_ context.Context, sub string) error {
	f.record("logout:" + sub)
	return f.err
}

func (f *fakeIdP) DeleteUser(ctx context.Context, sub string) error {
	f.record("delete:" + sub)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleteCtxErr = ctx.Err()
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if f.err != nil {
		return f.err
	}
	delete(f.accounts, sub)
	delete(f.owners, sub)
	for email, s := range f.byEmail {
		if s == sub {
			delete(f.byEmail, email)
		}
	}
	return nil
}

type fakeNotifier struct {
	mu                     sync.Mutex
	employees, departments []uuid.UUID
}

func (f *fakeNotifier) EmployeeChanged(id uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.employees = append(f.employees, id)
}

func (f *fakeNotifier) DepartmentChanged(id uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.departments = append(f.departments, id)
}

func newService(t *testing.T) (*Service, *fakeIdP, *fakeNotifier) {
	t.Helper()
	idp, n := &fakeIdP{accounts: map[string]bool{}, byEmail: map[string]string{}, owners: map[string]string{}, passwordErr: map[string]error{}}, &fakeNotifier{}
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	counter := 0
	return &Service{
		Store: testStore(t), IdP: idp, Notifier: n, NewPassword: func() string { return "Tmp-pass-1" },
		Now: func() time.Time { return now }, InviteTTL: 7 * 24 * time.Hour,
		NewToken: func() string { counter++; return fmt.Sprintf("v%d", counter) },
	}, idp, n
}

func auditFor(id uuid.UUID) store.AuditFilter {
	return store.AuditFilter{TargetType: domain.TargetEmployee, TargetID: &id, Limit: 50}
}
