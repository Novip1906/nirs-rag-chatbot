package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/auth"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/service"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

const (
	maxBodyBytes    = 1 << 20
	defaultPage     = 1
	defaultPageSize = 50
	maxPageSize     = 200
	maxPage         = 100000
	maxQueryRunes   = 200
)

func decodeBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return &domain.ValidationError{Fields: map[string]string{"body": "invalid"}}
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return &domain.ValidationError{Fields: map[string]string{"body": "invalid"}}
	}
	return nil
}

func decodeOptionalBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return &domain.ValidationError{Fields: map[string]string{"body": "invalid"}}
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return &domain.ValidationError{Fields: map[string]string{"body": "invalid"}}
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return &domain.ValidationError{Fields: map[string]string{"body": "invalid"}}
	}
	return nil
}

func parseDepartmentID(raw json.RawMessage) (**uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if string(raw) == "null" {
		var none *uuid.UUID
		return &none, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, &domain.ValidationError{Fields: map[string]string{"department_id": "invalid"}}
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil, &domain.ValidationError{Fields: map[string]string{"department_id": "invalid"}}
	}
	p := &id
	return &p, nil
}

type employeeBody struct {
	Email        *string         `json:"email"`
	FirstName    *string         `json:"first_name"`
	LastName     *string         `json:"last_name"`
	Position     *string         `json:"position"`
	DepartmentID json.RawMessage `json:"department_id"`
	IsAdmin      *bool           `json:"is_admin"`
	IsHead       *bool           `json:"is_head"`
	Blocked      *bool           `json:"blocked"`
}

type createBody struct {
	Email        *string         `json:"email"`
	FirstName    *string         `json:"first_name"`
	LastName     *string         `json:"last_name"`
	Position     *string         `json:"position"`
	DepartmentID json.RawMessage `json:"department_id"`
}

func (b createBody) input() (service.EmployeeInput, error) {
	return employeeBody{Email: b.Email, FirstName: b.FirstName, LastName: b.LastName, Position: b.Position, DepartmentID: b.DepartmentID}.input()
}

func (b employeeBody) input() (service.EmployeeInput, error) {
	dep, err := parseDepartmentID(b.DepartmentID)
	if err != nil {
		return service.EmployeeInput{}, err
	}
	return service.EmployeeInput{
		Email: b.Email, FirstName: b.FirstName, LastName: b.LastName, Position: b.Position,
		DepartmentID: dep, IsAdmin: b.IsAdmin, IsHead: b.IsHead, Blocked: b.Blocked,
	}, nil
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

func clampPage(p int) int {
	if p < 1 {
		return defaultPage
	}
	return p
}

func clampPageSize(n int) int {
	switch {
	case n < 1:
		return defaultPageSize
	case n > maxPageSize:
		return maxPageSize
	}
	return n
}

func intParam(r *http.Request, name string) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, &domain.ValidationError{Fields: map[string]string{name: "invalid"}}
	}
	return n, nil
}

func (a *api) me(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	e, err := a.svc.Store.EmployeeBySub(r.Context(), p.Sub)
	if err != nil && !isNotFound(err) {
		writeErr(w, err)
		return
	}
	if err != nil || e.DeletedAt != nil {
		writeJSON(w, http.StatusOK, map[string]any{"employee": nil, "is_admin": false, "is_head": false, "can_confirm_name": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"employee":         a.employee(e),
		"is_admin":         e.Admin(),
		"is_head":          e.Head(),
		"can_confirm_name": e.Active(),
	})
}

func (a *api) listEmployees(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.EmployeeFilter{Query: truncateRunes(q.Get("q"), maxQueryRunes)}
	switch s := q.Get("status"); s {
	case "", "active", "blocked", "invited":
		f.Status = s
	default:
		writeValidation(w, map[string]string{"status": "invalid"})
		return
	}
	switch d := q.Get("department_id"); d {
	case "":
	case "none":
		f.NoDepartment = true
	default:
		id, err := uuid.Parse(d)
		if err != nil {
			writeValidation(w, map[string]string{"department_id": "invalid"})
			return
		}
		f.DepartmentID = &id
	}
	page, err := intParam(r, "page")
	if err != nil {
		writeErr(w, err)
		return
	}
	if page > maxPage {
		writeValidation(w, map[string]string{"page": "invalid"})
		return
	}
	size, err := intParam(r, "page_size")
	if err != nil {
		writeErr(w, err)
		return
	}
	page, size = clampPage(page), clampPageSize(size)
	f.Limit, f.Offset = size, (page-1)*size
	items, total, err := a.svc.ListEmployees(r.Context(), actor(r), f)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": a.employees(items), "total": total})
}

func (a *api) createEmployee(w http.ResponseWriter, r *http.Request) {
	var body createBody
	if err := decodeBody(w, r, &body); err != nil {
		writeErr(w, err)
		return
	}
	in, err := body.input()
	if err != nil {
		writeErr(w, err)
		return
	}
	inv, err := a.svc.CreateEmployee(r.Context(), actor(r), in)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSONNoStore(w, http.StatusCreated, a.invite(inv))
}

func (a *api) invite(inv service.Invite) map[string]any {
	return map[string]any{"employee": a.employee(inv.Employee), "invite_link": inv.Link, "email_sent": inv.EmailSent}
}

func (a *api) reinvite(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var body struct {
		Email *string `json:"email"`
	}
	if err := decodeOptionalBody(w, r, &body); err != nil {
		writeErr(w, err)
		return
	}
	inv, err := a.svc.Reinvite(r.Context(), actor(r), id, body.Email)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSONNoStore(w, http.StatusOK, a.invite(inv))
}

func (a *api) getEmployee(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	e, err := a.svc.GetEmployee(r.Context(), actor(r), id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}

func (a *api) patchEmployee(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var body employeeBody
	if err := decodeBody(w, r, &body); err != nil {
		writeErr(w, err)
		return
	}
	in, err := body.input()
	if err != nil {
		writeErr(w, err)
		return
	}
	e, err := a.svc.UpdateEmployee(r.Context(), actor(r), id, in)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}

func (a *api) deleteEmployee(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var onlyInvited bool
	switch r.URL.Query().Get("only_invited") {
	case "", "false":
	case "true":
		onlyInvited = true
	default:
		writeValidation(w, map[string]string{"only_invited": "invalid"})
		return
	}
	if err := a.svc.DeleteEmployee(r.Context(), actor(r), id, onlyInvited); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

func (a *api) resetPassword(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	pwd, err := a.svc.ResetPassword(r.Context(), actor(r), id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"temporary_password": pwd})
}
