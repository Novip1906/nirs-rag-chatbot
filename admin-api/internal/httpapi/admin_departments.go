package httpapi

import (
	"net/http"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/service"
)

type departmentBody struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

func (a *api) listDepartments(w http.ResponseWriter, r *http.Request) {
	if e := actor(r); !e.Admin() && !e.Head() {
		writeErr(w, domain.ErrForbidden)
		return
	}
	items, err := a.svc.Store.ListDepartments(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": toDepartments(items)})
}

func (a *api) createDepartment(w http.ResponseWriter, r *http.Request) {
	var body departmentBody
	if err := decodeBody(w, r, &body); err != nil {
		writeErr(w, err)
		return
	}
	d, err := a.svc.CreateDepartment(r.Context(), actor(r), departmentInput(body))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toDepartment(d))
}

func (a *api) patchDepartment(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var body departmentBody
	if err := decodeBody(w, r, &body); err != nil {
		writeErr(w, err)
		return
	}
	d, err := a.svc.UpdateDepartment(r.Context(), actor(r), id, departmentInput(body))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toDepartment(d))
}

func (a *api) deleteDepartment(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := a.svc.DeleteDepartment(r.Context(), actor(r), id); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

func departmentInput(b departmentBody) service.DepartmentInput {
	return service.DepartmentInput{Name: b.Name, Description: b.Description}
}
