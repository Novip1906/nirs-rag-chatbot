package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

var errorTable = []struct {
	err     error
	status  int
	code    string
	message string
}{
	{domain.ErrForbidden, 403, "forbidden", "Недостаточно прав"},
	{domain.ErrNotFound, 404, "not_found", "Запись не найдена"},
	{domain.ErrEmailTaken, 409, "email_taken", "Сотрудник с такой почтой уже есть"},
	{domain.ErrDepartmentNameTaken, 409, "department_name_taken", "Отдел с таким названием уже есть"},
	{domain.ErrDepartmentNotEmpty, 409, "department_not_empty", "В отделе есть сотрудники"},
	{domain.ErrLastAdmin, 409, "last_admin", "Нельзя оставить систему без администратора"},
	{domain.ErrSelfAdminRevoke, 409, "self_admin_revoke", "Нельзя снять права администратора с себя"},
	{domain.ErrSelfBlock, 409, "self_block", "Нельзя заблокировать себя"},
	{domain.ErrSelfDelete, 409, "self_delete", "Нельзя удалить себя"},
	{domain.ErrIdPUnavailable, 503, "idp_unavailable", "Сервис входа недоступен, изменение не сохранено"},
	{domain.ErrIdPRejected, 502, "idp_rejected", "Сервис входа отклонил изменение"},
	{domain.ErrIdPAccountMissing, 409, "idp_account_missing", "У сотрудника нет учётной записи для входа. Обратитесь к администратору системы"},
	{domain.ErrReinviteRequired, 409, "reinvite_required", "Почту сотрудника, который ещё не вошёл, меняет повторное приглашение"},
	{domain.ErrAlreadyActive, 409, "already_active", "Сотрудник уже вошёл, приглашение не нужно"},
	{domain.ErrNotActivated, 409, "not_activated", "Сотрудник ещё не вошёл — отправьте приглашение заново"},
}

func isNotFound(err error) bool { return errors.Is(err, domain.ErrNotFound) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error_code": code, "message": message})
}

func writeJSONNoStore(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, v)
}

func writeValidation(w http.ResponseWriter, fields map[string]string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error_code": "validation_failed",
		"message":    "Данные не прошли проверку",
		"fields":     fields,
	})
}

func writeErr(w http.ResponseWriter, err error) {
	var v *domain.ValidationError
	if errors.As(err, &v) {
		writeValidation(w, v.Fields)
		return
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		err = domain.ErrIdPUnavailable
	}
	for _, row := range errorTable {
		if errors.Is(err, row.err) {
			writeError(w, row.status, row.code, row.message)
			return
		}
	}
	slog.Error("внутренняя ошибка", "error", err.Error())
	writeError(w, http.StatusInternalServerError, "internal", "Внутренняя ошибка")
}

func parseID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		return uuid.Nil, domain.ErrNotFound
	}
	return id, nil
}
