package httpapi

import (
	"context"
	"net/http"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/auth"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/service"
)

type api struct {
	svc           *service.Service
	publicBaseURL string
}

type actorKey struct{}

func NewHandler(svc *service.Service, mw *auth.Middleware, publicBaseURL string) http.Handler {
	a := &api{svc: svc, publicBaseURL: publicBaseURL}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) })

	mux.HandleFunc("GET /avatars/{id}/{file}", a.avatar)

	read := http.NewServeMux()
	read.HandleFunc("GET /v1/employees", a.readEmployees)
	read.HandleFunc("GET /v1/employees/by-sub/{sub}", a.readEmployeeBySub)
	read.HandleFunc("GET /v1/employees/{id}", a.readEmployee)
	read.HandleFunc("GET /v1/departments", a.readDepartments)
	mux.Handle("/v1/", mw.RequireReader(read))

	admin := http.NewServeMux()
	admin.HandleFunc("GET /admin/v1/employees", a.listEmployees)
	admin.HandleFunc("POST /admin/v1/employees", a.createEmployee)
	admin.HandleFunc("GET /admin/v1/employees/{id}", a.getEmployee)
	admin.HandleFunc("PATCH /admin/v1/employees/{id}", a.patchEmployee)
	admin.HandleFunc("DELETE /admin/v1/employees/{id}", a.deleteEmployee)
	admin.HandleFunc("POST /admin/v1/employees/{id}/invite", a.reinvite)
	admin.HandleFunc("POST /admin/v1/employees/{id}/reset-password", a.resetPassword)
	admin.HandleFunc("POST /admin/v1/me/confirm-name", a.confirmName)
	admin.HandleFunc("PUT /admin/v1/me/avatar", a.putOwnAvatar)
	admin.HandleFunc("DELETE /admin/v1/me/avatar", a.deleteOwnAvatar)
	admin.HandleFunc("DELETE /admin/v1/employees/{id}/avatar", a.deleteEmployeeAvatar)
	admin.HandleFunc("GET /admin/v1/audit", a.listAudit)
	admin.HandleFunc("GET /admin/v1/departments", a.listDepartments)
	admin.HandleFunc("POST /admin/v1/departments", a.createDepartment)
	admin.HandleFunc("PATCH /admin/v1/departments/{id}", a.patchDepartment)
	admin.HandleFunc("DELETE /admin/v1/departments/{id}", a.deleteDepartment)

	mux.Handle("GET /admin/v1/me", mw.RequireUser(http.HandlerFunc(a.me)))
	mux.Handle("/admin/v1/", mw.RequireUser(a.requireActor(admin)))
	return mux
}

func (a *api) requireActor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := auth.PrincipalFrom(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Требуется вход")
			return
		}
		e, err := a.svc.Store.EmployeeBySub(r.Context(), p.Sub)
		if err != nil && !isNotFound(err) {
			writeErr(w, err)
			return
		}
		if err != nil || !e.Active() {
			writeError(w, http.StatusForbidden, "forbidden", "Недостаточно прав")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, e)))
	})
}

func actor(r *http.Request) domain.Employee {
	e, _ := r.Context().Value(actorKey{}).(domain.Employee)
	return e
}
