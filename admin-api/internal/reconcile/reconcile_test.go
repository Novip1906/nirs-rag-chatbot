package reconcile

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
)

type fakeIdP struct {
	users        map[string]keycloak.User
	updates      []string
	updated      map[string]keycloak.Profile
	failOnGet    string
	getErr       error
	gets         int
	beforeUpdate func()
	onGet        func()
}

func newIdP() *fakeIdP {
	return &fakeIdP{users: map[string]keycloak.User{}, updated: map[string]keycloak.Profile{}}
}

func (f *fakeIdP) GetProfile(_ context.Context, sub string) (keycloak.User, error) {
	f.gets++
	if f.onGet != nil {
		f.onGet()
	}
	if sub == f.failOnGet {
		return keycloak.User{}, f.getErr
	}
	u, ok := f.users[sub]
	if !ok {
		return keycloak.User{}, domain.ErrIdPAccountMissing
	}
	return u, nil
}

func (f *fakeIdP) UpdateUser(_ context.Context, sub string, p keycloak.Profile) error {
	if f.beforeUpdate != nil {
		f.beforeUpdate()
	}
	f.updates = append(f.updates, sub)
	f.updated[sub] = p
	return nil
}

type fakeLister struct {
	list  []domain.Employee
	fresh map[uuid.UUID]domain.Employee
}

func (f fakeLister) ActiveEmployees(context.Context) ([]domain.Employee, error) { return f.list, nil }

func (f fakeLister) EmployeeByID(_ context.Context, id uuid.UUID) (domain.Employee, error) {
	if e, ok := f.fresh[id]; ok {
		return e, nil
	}
	for _, e := range f.list {
		if e.ID == id {
			return e, nil
		}
	}
	return domain.Employee{}, domain.ErrNotFound
}

func emp(i int, blocked bool) domain.Employee {
	return domain.Employee{
		ID: uuid.New(), Sub: fmt.Sprintf("sub-%d", i), Email: fmt.Sprintf("u%d@example.com", i),
		FirstName: "Имя", LastName: "Фамилия", Blocked: blocked,
	}
}

func (f *fakeIdP) mirror(e domain.Employee) {
	f.users[e.Sub] = keycloak.User{ID: e.Sub, Email: e.Email, FirstName: e.FirstName, LastName: e.LastName, Enabled: !e.Blocked}
}

func TestRun_FixesDrift(t *testing.T) {
	idp := newIdP()
	e := emp(1, false)
	idp.mirror(e)
	u := idp.users[e.Sub]
	u.LastName = "Старая"
	idp.users[e.Sub] = u
	r, err := Run(context.Background(), fakeLister{list: []domain.Employee{e}}, idp, 5, 5)
	require.NoError(t, err)
	require.Equal(t, []string{e.Sub}, idp.updates)
	require.Equal(t, keycloak.Profile{Email: e.Email, FirstName: e.FirstName, LastName: e.LastName, Enabled: true}, idp.updated[e.Sub])
	require.Equal(t, []string{e.Sub}, r.Fixed)
}

func TestRun_NoChangesNoCalls(t *testing.T) {
	idp := newIdP()
	var list []domain.Employee
	for i := 0; i < 3; i++ {
		e := emp(i, i == 2)
		idp.mirror(e)
		list = append(list, e)
	}
	r, err := Run(context.Background(), fakeLister{list: list}, idp, 5, 5)
	require.NoError(t, err)
	require.Empty(t, idp.updates)
	require.Empty(t, r.Fixed)
	require.False(t, r.Skipped)
}

func TestRun_TooManyDisablesSkipsEverything(t *testing.T) {
	idp := newIdP()
	var list []domain.Employee
	for i := 0; i < 6; i++ {
		e := emp(i, true)
		idp.mirror(e)
		u := idp.users[e.Sub]
		u.Enabled = true
		idp.users[e.Sub] = u
		list = append(list, e)
	}
	e := emp(10, false)
	idp.mirror(e)
	u := idp.users[e.Sub]
	u.FirstName = "Другое"
	idp.users[e.Sub] = u
	list = append(list, e)
	r, err := Run(context.Background(), fakeLister{list: list}, idp, 5, 5)
	require.NoError(t, err)
	require.Empty(t, idp.updates)
	require.True(t, r.Skipped)
	require.Equal(t, 6, r.Disables)
}

func TestRun_MissingReported(t *testing.T) {
	idp := newIdP()
	e := emp(1, false)
	r, err := Run(context.Background(), fakeLister{list: []domain.Employee{e}}, idp, 5, 5)
	require.NoError(t, err)
	require.Equal(t, []string{e.Sub}, r.Missing)
	require.Empty(t, idp.updates)
}

func TestRun_UnavailableAborts(t *testing.T) {
	idp := newIdP()
	var list []domain.Employee
	for i := 0; i < 4; i++ {
		e := emp(i, false)
		idp.mirror(e)
		u := idp.users[e.Sub]
		u.LastName = "Старая"
		idp.users[e.Sub] = u
		list = append(list, e)
	}
	idp.failOnGet = list[2].Sub
	idp.getErr = domain.ErrIdPUnavailable
	_, err := Run(context.Background(), fakeLister{list: list}, idp, 5, 5)
	require.ErrorIs(t, err, domain.ErrIdPUnavailable)
	require.Empty(t, idp.updates)
}

func TestLoop_StopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		Loop(ctx, time.Hour, func(context.Context) (Report, error) { return Report{}, nil })
		close(done)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Loop не остановился по отмене контекста")
	}
}

func driftedBlocked(idp *fakeIdP) domain.Employee {
	e := emp(1, false)
	idp.mirror(e)
	u := idp.users[e.Sub]
	u.Enabled = false
	idp.users[e.Sub] = u
	return e
}

func TestRun_RowBlockedAfterListIsNotReEnabled(t *testing.T) {
	idp := newIdP()
	e := driftedBlocked(idp)
	blocked := e
	blocked.Blocked = true
	blocked.UpdatedAt = time.Now().Add(-time.Hour)
	l := fakeLister{list: []domain.Employee{e}, fresh: map[uuid.UUID]domain.Employee{e.ID: blocked}}
	r, err := Run(context.Background(), l, idp, 5, 5)
	require.NoError(t, err)
	require.Empty(t, idp.updates)
	require.Empty(t, r.Fixed)
}

func TestRun_RecentlyUpdatedRowSkipped(t *testing.T) {
	idp := newIdP()
	e := driftedBlocked(idp)
	recent := e
	recent.UpdatedAt = time.Now().Add(-10 * time.Second)
	l := fakeLister{list: []domain.Employee{e}, fresh: map[uuid.UUID]domain.Employee{e.ID: recent}}
	r, err := Run(context.Background(), l, idp, 5, 5)
	require.NoError(t, err)
	require.Empty(t, idp.updates)
	require.Empty(t, r.Fixed)

	old := e
	old.UpdatedAt = time.Now().Add(-2 * time.Minute)
	l.fresh = map[uuid.UUID]domain.Employee{e.ID: old}
	r, err = Run(context.Background(), l, idp, 5, 5)
	require.NoError(t, err)
	require.Equal(t, []string{e.Sub}, r.Fixed)
}

func TestRun_DeletedRowSkipped(t *testing.T) {
	idp := newIdP()
	e := driftedBlocked(idp)
	gone := e
	now := time.Now().Add(-time.Hour)
	gone.DeletedAt = &now
	l := fakeLister{list: []domain.Employee{e}, fresh: map[uuid.UUID]domain.Employee{e.ID: gone}}
	_, err := Run(context.Background(), l, idp, 5, 5)
	require.NoError(t, err)
	require.Empty(t, idp.updates)
}

func TestRun_AccountChangedBetweenListAndApplyRecompared(t *testing.T) {
	idp := newIdP()
	e := emp(1, false)
	idp.mirror(e)
	u := idp.users[e.Sub]
	u.LastName = "Старая"
	idp.users[e.Sub] = u
	idp.beforeUpdate = nil
	l := fakeLister{list: []domain.Employee{e}}
	gets := 0
	idp.onGet = func() {
		gets++
		if gets == 2 {
			fixed := idp.users[e.Sub]
			fixed.LastName = e.LastName
			idp.users[e.Sub] = fixed
		}
	}
	_, err := Run(context.Background(), l, idp, 5, 5)
	require.NoError(t, err)
	require.Empty(t, idp.updates)
}

func TestRun_TooManyEnablesSkipsEverything(t *testing.T) {
	idp := newIdP()
	var employees []domain.Employee
	for i := 0; i < 6; i++ {
		e := domain.Employee{ID: uuid.New(), Sub: fmt.Sprintf("sub-%d", i), Email: fmt.Sprintf("u%d@example.com", i), FirstName: "Т", UpdatedAt: time.Now().Add(-time.Hour)}
		employees = append(employees, e)
		idp.users[e.Sub] = keycloak.User{Email: e.Email, FirstName: e.FirstName, Enabled: false}
	}
	report, err := Run(context.Background(), fakeLister{list: employees}, idp, 5, 5)
	require.NoError(t, err)
	require.True(t, report.Skipped)
	require.Equal(t, 6, report.Enables)
	require.Empty(t, idp.updates)
}

func TestRun_EnablesWithinLimitAreApplied(t *testing.T) {
	idp := newIdP()
	var employees []domain.Employee
	for i := 0; i < 5; i++ {
		e := domain.Employee{ID: uuid.New(), Sub: fmt.Sprintf("sub-%d", i), Email: fmt.Sprintf("u%d@example.com", i), FirstName: "Т", UpdatedAt: time.Now().Add(-time.Hour)}
		employees = append(employees, e)
		idp.users[e.Sub] = keycloak.User{Email: e.Email, FirstName: e.FirstName, Enabled: false}
	}
	report, err := Run(context.Background(), fakeLister{list: employees}, idp, 5, 5)
	require.NoError(t, err)
	require.False(t, report.Skipped)
	require.Equal(t, 5, report.Enables)
	require.Len(t, idp.updates, 5)
}
