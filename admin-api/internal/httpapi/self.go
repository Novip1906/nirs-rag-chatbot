package httpapi

import (
	"errors"
	"io"
	"net/http"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/imageproc"
)

func (a *api) confirmName(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	}
	if err := decodeBody(w, r, &body); err != nil {
		writeErr(w, err)
		return
	}
	e, err := a.svc.ConfirmName(r.Context(), actor(r), body.FirstName, body.LastName)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}

func (a *api) putOwnAvatar(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, imageproc.MaxBytes+1)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeValidation(w, map[string]string{"avatar": "too_large"})
			return
		}
		writeErr(w, &domain.ValidationError{Fields: map[string]string{"avatar": "invalid"}})
		return
	}
	e, err := a.svc.SetOwnAvatar(r.Context(), actor(r), raw)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}

func (a *api) deleteOwnAvatar(w http.ResponseWriter, r *http.Request) {
	me := actor(r)
	e, err := a.svc.RemoveAvatar(r.Context(), me, me.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}

func (a *api) deleteEmployeeAvatar(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	e, err := a.svc.RemoveAvatar(r.Context(), actor(r), id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.employee(e))
}
