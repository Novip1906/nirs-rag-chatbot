package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

type auditActorJSON struct {
	ID        string `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type auditJSON struct {
	ID         int64           `json:"id"`
	At         string          `json:"at"`
	Actor      *auditActorJSON `json:"actor"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Details    map[string]any  `json:"details"`
}

func toAudit(items []domain.AuditEntry) []auditJSON {
	out := make([]auditJSON, 0, len(items))
	for _, e := range items {
		row := auditJSON{
			ID: e.ID, At: formatTime(e.At), Action: e.Action, TargetType: e.TargetType,
			TargetID: e.TargetID.String(), Details: e.Details,
		}
		if row.Details == nil {
			row.Details = map[string]any{}
		}
		if e.ActorID != nil {
			row.Actor = &auditActorJSON{ID: e.ActorID.String(), FirstName: e.ActorFirstName, LastName: e.ActorLastName}
		}
		out = append(out, row)
	}
	return out
}

func (a *api) listAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var f store.AuditFilter
	empID, depID := q.Get("employee_id"), q.Get("department_id")
	if empID != "" && depID != "" {
		writeValidation(w, map[string]string{"department_id": "invalid"})
		return
	}
	parse := func(name, raw, targetType string) bool {
		id, err := uuid.Parse(raw)
		if err != nil {
			writeValidation(w, map[string]string{name: "invalid"})
			return false
		}
		f.TargetType, f.TargetID = targetType, &id
		return true
	}
	switch {
	case empID != "":
		if !parse("employee_id", empID, domain.TargetEmployee) {
			return
		}
	case depID != "":
		if !parse("department_id", depID, domain.TargetDepartment) {
			return
		}
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
	items, total, err := a.svc.ListAudit(r.Context(), actor(r), f)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": toAudit(items), "total": total})
}
