package importer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

const (
	NotEmptyWarning      = "Предупреждение: база не пуста, --apply откажет"
	DryRunNotice         = "Ничего не записано. Для применения добавьте --apply"
	serviceAccountPrefix = "service-account-"
	noAdminWarning       = "после переноса некому войти в админку"
)

var (
	ErrNotEmpty = errors.New("в базе уже есть сотрудники или отделы")
	ErrNoAdmin  = errors.New("в плане нет ни одного незаблокированного администратора, перенос не выполнен")
)

const missingAdminFormat = "%s: администратор из AI или --admin-subs не попал в перенос"

type AIRecord struct {
	Sub        string `json:"sub"`
	EmployeeID string `json:"employeeId"`
	Role       string `json:"role"`
	Blocked    bool   `json:"blocked"`
}

type Source interface {
	ListUsers(ctx context.Context) ([]keycloak.User, error)
}

type Plan struct {
	Departments []domain.Department
	Employees   []domain.Employee
	Warnings    []string
}

func WithExtraAdmins(ai []AIRecord, subs []string) []AIRecord {
	out := slices.Clone(ai)
	for _, raw := range subs {
		sub := strings.TrimSpace(raw)
		if sub == "" {
			continue
		}
		i := slices.IndexFunc(out, func(r AIRecord) bool { return r.Sub == sub })
		if i < 0 {
			out = append(out, AIRecord{Sub: sub, Role: "ADMIN"})
			continue
		}
		out[i].Role = "ADMIN"
	}
	return out
}

type Options struct {
	SplitNames bool
}

func Build(users []keycloak.User, ai []AIRecord, departmentNames []string) Plan {
	return BuildWithOptions(users, ai, departmentNames, Options{})
}

func BuildWithOptions(users []keycloak.User, ai []AIRecord, departmentNames []string, opts Options) Plan {
	var p Plan
	byName := map[string]uuid.UUID{}
	for _, raw := range departmentNames {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if _, dup := byName[name]; dup {
			continue
		}
		d := domain.Department{ID: uuid.New(), Name: name}
		byName[name] = d.ID
		p.Departments = append(p.Departments, d)
	}

	aiBySub := map[string]AIRecord{}
	for _, r := range ai {
		aiBySub[r.Sub] = r
	}

	seenEmail := map[string]bool{}
	seenID := map[uuid.UUID]bool{}
	for _, u := range users {
		if strings.HasPrefix(u.Username, serviceAccountPrefix) {
			continue
		}
		email := strings.ToLower(strings.TrimSpace(u.Email))
		if email == "" {
			name := u.Username
			if name == "" {
				name = u.ID
			}
			p.warn("%s: нет почты, пропущена", name)
			continue
		}
		if seenEmail[email] {
			p.warn("%s: повтор почты, учётная запись %s пропущена", email, u.ID)
			continue
		}
		seenEmail[email] = true

		rec, hasAI := aiBySub[u.ID]
		e := domain.Employee{Sub: u.ID, Email: email, FirstName: u.FirstName, LastName: u.LastName}

		id, ok := uuid.Nil, false
		attrID, attrOK := parseUUID(u.EmployeeID)
		if hasAI {
			id, ok = parseUUID(rec.EmployeeID)
			if ok && attrOK && id != attrID {
				p.warn("%s: employeeId в AI (%s) и в учётной записи (%s) расходятся, взят из AI", email, id, attrID)
			}
		}
		if !ok {
			id, ok = attrID, attrOK
		}
		switch {
		case !ok:
			id = uuid.New()
			p.warn("%s: нет employeeId, выдан новый идентификатор", email)
		case seenID[id]:
			p.warn("%s: повтор идентификатора сотрудника %s, выдан новый", email, id)
			id = uuid.New()
		}
		seenID[id] = true
		e.ID = id

		e.IsAdmin = hasAI && isAdminRole(rec.Role)
		e.Blocked = !u.Enabled || (hasAI && rec.Blocked)

		if strings.TrimSpace(e.FirstName) == "" {
			e.FirstName, _, _ = strings.Cut(email, "@")
			p.warn("%s: пустое имя заменено на часть почты", email)
		}
		e.FirstName = strings.Join(strings.Fields(e.FirstName), " ")
		e.LastName = strings.Join(strings.Fields(e.LastName), " ")
		if e.LastName == "" {
			if first, rest, ok := strings.Cut(e.FirstName, " "); ok && opts.SplitNames {
				e.FirstName, e.LastName = first, rest
				p.warn("%s: полное имя из одного поля разделено на имя «%s» и фамилию «%s»", email, first, rest)
			} else {
				p.warn("%s: пустая фамилия, заполните в админке", email)
			}
		}

		var groups []string
		for _, g := range u.Groups {
			if _, isDept := byName[g]; isDept && !slices.Contains(groups, g) {
				groups = append(groups, g)
			}
		}
		switch {
		case len(groups) == 1:
			depID := byName[groups[0]]
			e.DepartmentID = &depID
		case len(groups) > 1:
			p.warn("%s: несколько отделов (%s), отдел не назначен", email, strings.Join(groups, ", "))
		}

		p.Employees = append(p.Employees, e)
	}

	imported := map[string]bool{}
	for _, e := range p.Employees {
		imported[e.Sub] = true
	}
	warnedAdmin := map[string]bool{}
	for _, r := range ai {
		if isAdminRole(r.Role) && !imported[r.Sub] && !warnedAdmin[r.Sub] {
			warnedAdmin[r.Sub] = true
			p.warn(missingAdminFormat, r.Sub)
		}
	}

	if !p.HasActiveAdmin() {
		p.Warnings = append(p.Warnings, noAdminWarning)
	}
	return p
}

func isAdminRole(role string) bool { return role == "OWNER" || role == "ADMIN" }

func (p Plan) HasActiveAdmin() bool {
	return slices.ContainsFunc(p.Employees, func(e domain.Employee) bool { return e.IsAdmin && !e.Blocked })
}

func (p *Plan) warn(format string, args ...any) {
	p.Warnings = append(p.Warnings, fmt.Sprintf(format, args...))
}

func parseUUID(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func Print(w io.Writer, p Plan) {
	admins, blocked := 0, 0
	for _, e := range p.Employees {
		if e.IsAdmin {
			admins++
		}
		if e.Blocked {
			blocked++
		}
	}
	_, _ = fmt.Fprintf(w, "Отделов: %d\n", len(p.Departments))
	_, _ = fmt.Fprintf(w, "Сотрудников: %d, из них администраторов: %d, заблокированных: %d\n", len(p.Employees), admins, blocked)
	if len(p.Warnings) == 0 {
		_, _ = fmt.Fprintln(w, "Предупреждений нет")
	} else {
		_, _ = fmt.Fprintf(w, "Предупреждения (%d):\n", len(p.Warnings))
		for _, msg := range p.Warnings {
			_, _ = fmt.Fprintf(w, "  - %s\n", msg)
		}
	}
}

func HasData(ctx context.Context, s *store.Store) (bool, error) {
	var has bool
	err := s.InTx(ctx, func(tx *store.Tx) error {
		var err error
		has, err = tx.HasRows(ctx)
		return err
	})
	return has, err
}

func Apply(ctx context.Context, s *store.Store, p Plan) error {
	if !p.HasActiveAdmin() {
		return ErrNoAdmin
	}
	return s.InTx(ctx, func(tx *store.Tx) error {
		has, err := tx.HasRows(ctx)
		if err != nil {
			return err
		}
		if has {
			return ErrNotEmpty
		}
		for _, d := range p.Departments {
			if _, err := tx.InsertDepartment(ctx, d); err != nil {
				return err
			}
		}
		activated := time.Now()
		for _, e := range p.Employees {
			if e.ActivatedAt == nil {
				e.ActivatedAt = &activated
			}
			if _, err := tx.InsertEmployee(ctx, e); err != nil {
				return err
			}
		}
		return nil
	})
}
