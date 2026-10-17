package reconcile

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
)

const (
	firstRunDelay = 30 * time.Second
	recentWindow  = 60 * time.Second
)

type IdP interface {
	GetProfile(ctx context.Context, sub string) (keycloak.User, error)
	UpdateUser(ctx context.Context, sub string, p keycloak.Profile) error
}

type Lister interface {
	ActiveEmployees(ctx context.Context) ([]domain.Employee, error)
	EmployeeByID(ctx context.Context, id uuid.UUID) (domain.Employee, error)
}

type Report struct {
	Fixed    []string
	Missing  []string
	Skipped  bool
	Disables int
	Enables  int
}

type change struct {
	id  uuid.UUID
	sub string
}

func drifted(e domain.Employee, u keycloak.User) bool {
	return !strings.EqualFold(strings.TrimSpace(u.Email), e.Email) ||
		u.FirstName != e.FirstName ||
		u.LastName != e.LastName ||
		u.Enabled == e.Blocked
}

func Run(ctx context.Context, l Lister, idp IdP, maxDisables, maxEnables int) (Report, error) {
	employees, err := l.ActiveEmployees(ctx)
	if err != nil {
		return Report{}, err
	}
	var report Report
	var plan []change
	for _, e := range employees {
		u, err := idp.GetProfile(ctx, e.Sub)
		if errors.Is(err, domain.ErrIdPAccountMissing) {
			slog.Warn("учётная запись сотрудника отсутствует в сервисе входа", "id", e.ID, "sub", e.Sub)
			report.Missing = append(report.Missing, e.Sub)
			continue
		}
		if err != nil {
			return report, err
		}
		if !drifted(e, u) {
			continue
		}
		if u.Enabled && e.Blocked {
			report.Disables++
		}
		if !u.Enabled && !e.Blocked {
			report.Enables++
		}
		plan = append(plan, change{id: e.ID, sub: e.Sub})
	}
	if report.Disables > maxDisables || report.Enables > maxEnables {
		report.Skipped = true
		return report, nil
	}
	for _, c := range plan {
		applied, err := apply(ctx, l, idp, c)
		if err != nil {
			return report, err
		}
		if applied {
			report.Fixed = append(report.Fixed, c.sub)
		}
	}
	return report, nil
}

func apply(ctx context.Context, l Lister, idp IdP, c change) (bool, error) {
	e, err := l.EmployeeByID(ctx, c.id)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if e.DeletedAt != nil || e.Sub != c.sub || time.Since(e.UpdatedAt) < recentWindow {
		return false, nil
	}
	u, err := idp.GetProfile(ctx, e.Sub)
	if errors.Is(err, domain.ErrIdPAccountMissing) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !drifted(e, u) {
		return false, nil
	}
	profile := keycloak.Profile{Email: e.Email, FirstName: e.FirstName, LastName: e.LastName, Enabled: !e.Blocked}
	if err := idp.UpdateUser(ctx, e.Sub, profile); err != nil {
		return false, err
	}
	return true, nil
}

func Loop(ctx context.Context, interval time.Duration, run func(context.Context) (Report, error)) {
	timer := time.NewTimer(firstRunDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		report, err := run(ctx)
		switch {
		case err != nil:
			slog.Error("самолечение зеркала прервано", "error", err.Error(), "fixed", len(report.Fixed))
		case report.Skipped:
			slog.Error("самолечение пропущено: слишком много выключений или включений", "disables", report.Disables, "enables", report.Enables)
		default:
			slog.Info("самолечение зеркала", "fixed", len(report.Fixed), "missing", len(report.Missing))
		}
		timer.Reset(interval)
	}
}
