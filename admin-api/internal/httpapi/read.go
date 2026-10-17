package httpapi

import (
	"net/http"
	"time"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func parseSince(r *http.Request) (time.Time, bool, error) {
	since := time.Unix(0, 0).UTC()
	if raw := r.URL.Query().Get("updated_since"); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return time.Time{}, false, &domain.ValidationError{Fields: map[string]string{"updated_since": "invalid"}}
		}
		since = t
	}
	include := false
	switch r.URL.Query().Get("include_deleted") {
	case "", "false":
	case "true":
		include = true
	default:
		return time.Time{}, false, &domain.ValidationError{Fields: map[string]string{"include_deleted": "invalid"}}
	}
	return since, include, nil
}

func (a *api) readEmployees(w http.ResponseWriter, r *http.Request) {
	since, include, err := parseSince(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	items, err := a.svc.Store.EmployeesChangedSince(r.Context(), since, include)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": a.employees(items)})
}

func (a *api) readEmployee(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	e, err := a.svc.Store.EmployeeByID(r.Context(), id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}

func (a *api) readEmployeeBySub(w http.ResponseWriter, r *http.Request) {
	e, err := a.svc.Store.EmployeeBySub(r.Context(), r.PathValue("sub"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}

func (a *api) readDepartments(w http.ResponseWriter, r *http.Request) {
	since, include, err := parseSince(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	items, err := a.svc.Store.DepartmentsChangedSince(r.Context(), since, include)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": toDepartments(items)})
}
