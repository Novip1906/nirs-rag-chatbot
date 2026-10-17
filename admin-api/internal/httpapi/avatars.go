package httpapi

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

func (a *api) avatar(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	version, ok := strings.CutSuffix(r.PathValue("file"), ".jpg")
	if err != nil || !ok || version == "" {
		writeErr(w, domain.ErrNotFound)
		return
	}
	content, err := a.svc.Store.Avatar(r.Context(), id, version)
	if err != nil {
		writeErr(w, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "image/jpeg")
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(content)
}
