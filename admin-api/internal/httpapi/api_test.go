package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/auth"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/service"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

type claimsValidator struct{}

func (claimsValidator) Validate(token string) (map[string]any, error) {
	var c map[string]any
	if err := json.Unmarshal([]byte(token), &c); err != nil {
		return nil, auth.ErrInvalidToken
	}
	return c, nil
}

func userToken(sub string) string {
	return `{"sub":"` + sub + `","aud":"admin-api","azp":"admin"}`
}

const readerToken = `{"sub":"svc","aud":"admin-api","azp":"ai-admin-api"}`

type fakeIdP struct {
	err      error
	accounts map[string]bool
}

func (f *fakeIdP) CreateInvited(_ context.Context, id string, _ keycloak.Profile) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	sub := "sub-" + id + "-" + uuid.NewString()
	f.accounts[sub] = false
	return sub, nil
}

func (f *fakeIdP) MagicLink(_ context.Context, sub, _ string, _ time.Duration) (keycloak.InviteLink, error) {
	return keycloak.InviteLink{Link: "https://auth.test/link/" + sub, Sent: true}, f.err
}

func (f *fakeIdP) HasPassword(_ context.Context, sub string) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	has, ok := f.accounts[sub]
	if !ok {
		return false, domain.ErrIdPAccountMissing
	}
	return has, nil
}

func (f *fakeIdP) FindByEmail(context.Context, string) (keycloak.User, bool, error) {
	return keycloak.User{}, false, f.err
}
func (f *fakeIdP) UpdateUser(context.Context, string, keycloak.Profile) error { return f.err }
func (f *fakeIdP) SetPassword(context.Context, string, string) error          { return f.err }
func (f *fakeIdP) Logout(context.Context, string) error                       { return f.err }
func (f *fakeIdP) DeleteUser(context.Context, string) error                   { return f.err }

type fakeNotifier struct{}

func (fakeNotifier) EmployeeChanged(uuid.UUID)   {}
func (fakeNotifier) DepartmentChanged(uuid.UUID) {}

type env struct {
	h   http.Handler
	s   *store.Store
	idp *fakeIdP
}

func newEnv(t *testing.T) *env {
	t.Helper()
	s := testStore(t)
	idp := &fakeIdP{accounts: map[string]bool{}}
	svc := &service.Service{Store: s, IdP: idp, Notifier: fakeNotifier{}, NewPassword: func() string { return "Tmp-pass-1" },
		Now: time.Now, InviteTTL: 7 * 24 * time.Hour,
		NewToken: func() string { return uuid.NewString() }}
	mw := &auth.Middleware{Validator: claimsValidator{}, Audience: "admin-api", ReaderClients: []string{"ai-admin-api"}, AdminClients: []string{"admin"}}
	return &env{h: NewHandler(svc, mw, "https://admin.test/api"), s: s, idp: idp}
}

func (e *env) seedWith(t *testing.T, email string, mut func(*domain.Employee)) domain.Employee {
	t.Helper()
	var out domain.Employee
	now := time.Now()
	emp := domain.Employee{ID: uuid.New(), Sub: "sub-" + email, Email: email, FirstName: "Имя", LastName: "Фамилия", ActivatedAt: &now}
	mut(&emp)
	require.NoError(t, e.s.InTx(context.Background(), func(tx *store.Tx) error {
		var err error
		out, err = tx.InsertEmployee(context.Background(), emp)
		return err
	}))
	return out
}

func (e *env) seed(t *testing.T, email string, admin bool) domain.Employee {
	t.Helper()
	var out domain.Employee
	now := time.Now()
	require.NoError(t, e.s.InTx(context.Background(), func(tx *store.Tx) error {
		var err error
		out, err = tx.InsertEmployee(context.Background(), domain.Employee{
			ID: uuid.New(), Sub: "sub-" + email, Email: email, FirstName: "Имя", LastName: "Фамилия", IsAdmin: admin, ActivatedAt: &now,
		})
		return err
	}))
	return out
}

func (e *env) department(t *testing.T, name string) domain.Department {
	t.Helper()
	var out domain.Department
	require.NoError(t, e.s.InTx(context.Background(), func(tx *store.Tx) error {
		var err error
		out, err = tx.InsertDepartment(context.Background(), domain.Department{ID: uuid.New(), Name: name})
		return err
	}))
	return out
}

func call(t *testing.T, h http.Handler, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	switch b := body.(type) {
	case nil:
		reader = bytes.NewReader(nil)
	case string:
		reader = bytes.NewReader([]byte(b))
	default:
		raw, err := json.Marshal(b)
		require.NoError(t, err)
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, "application/json; charset=utf-8", rec.Header().Get("Content-Type"))
	var out map[string]any
	if rec.Body.Len() > 0 {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	}
	return rec.Code, out
}

func TestAdminAPI_RequiresAdminFlag(t *testing.T) {
	env := newEnv(t)
	plain := env.seed(t, "user@example.com", false)
	status, body := call(t, env.h, "GET", "/admin/v1/employees", userToken(plain.Sub), nil)
	require.Equal(t, 403, status)
	require.Equal(t, "forbidden", body["error_code"])
	status, body = call(t, env.h, "GET", "/admin/v1/me", userToken(plain.Sub), nil)
	require.Equal(t, 200, status)
	require.Equal(t, false, body["is_admin"])
	status, body = call(t, env.h, "GET", "/admin/v1/me", userToken("unknown-sub"), nil)
	require.Equal(t, 200, status)
	require.Nil(t, body["employee"])
}

func TestAdminAPI_BlockedAdminForbidden(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	b := env.seed(t, "b@example.com", true)
	status, _ := call(t, env.h, "PATCH", "/admin/v1/employees/"+b.ID.String(), userToken(a.Sub), map[string]any{"blocked": true})
	require.Equal(t, 200, status)
	status, _ = call(t, env.h, "GET", "/admin/v1/employees", userToken(b.Sub), nil)
	require.Equal(t, 403, status)
	status, body := call(t, env.h, "GET", "/admin/v1/me", userToken(b.Sub), nil)
	require.Equal(t, 200, status)
	require.Equal(t, false, body["is_admin"])
}

func TestAdminAPI_CreateAndPatch(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	status, body := call(t, env.h, "POST", "/admin/v1/employees", userToken(a.Sub),
		map[string]any{"email": "new@example.com", "first_name": "Нина", "last_name": "Ким", "position": "Юрист"})
	require.Equal(t, 201, status)
	require.NotEmpty(t, body["invite_link"])
	emp := body["employee"].(map[string]any)
	require.Equal(t, "Юрист", emp["position"])
	require.Nil(t, emp["department_id"])
	require.Contains(t, emp, "department_id")
	require.Contains(t, emp, "deleted_at")

	dep := env.department(t, "Юристы")
	path := "/admin/v1/employees/" + emp["id"].(string)
	status, body = call(t, env.h, "PATCH", path, userToken(a.Sub), map[string]any{"department_id": dep.ID.String()})
	require.Equal(t, 200, status)
	require.Equal(t, dep.ID.String(), body["department_id"])
	status, body = call(t, env.h, "PATCH", path, userToken(a.Sub), map[string]any{"department_id": nil})
	require.Equal(t, 200, status)
	require.Nil(t, body["department_id"])
	status, body = call(t, env.h, "PATCH", path, userToken(a.Sub), map[string]any{"position": "Старший юрист"})
	require.Equal(t, 200, status)
	require.Nil(t, body["department_id"])
}

func TestAdminAPI_ErrorMapping(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	cases := []struct {
		name, method, path string
		body               any
		status             int
		code               string
		idpErr             error
	}{
		{"дубль почты", "POST", "/admin/v1/employees", map[string]any{"email": "a@example.com", "first_name": "А", "last_name": "Б"}, 409, "email_taken", nil},
		{"пустое имя", "POST", "/admin/v1/employees", map[string]any{"email": "x@example.com", "first_name": "", "last_name": "Б"}, 400, "validation_failed", nil},
		{"нет такого", "GET", "/admin/v1/employees/" + uuid.NewString(), nil, 404, "not_found", nil},
		{"кривой id", "GET", "/admin/v1/employees/abc", nil, 404, "not_found", nil},
		{"снять админа с себя", "PATCH", "/admin/v1/employees/" + a.ID.String(), map[string]any{"is_admin": false}, 409, "self_admin_revoke", nil},
		{"лишнее поле", "PATCH", "/admin/v1/employees/" + a.ID.String(), map[string]any{"sub": "x"}, 400, "validation_failed", nil},
		{"не JSON", "POST", "/admin/v1/employees", "{", 400, "validation_failed", nil},
		{"кривой статус", "GET", "/admin/v1/employees?status=weird", nil, 400, "validation_failed", nil},
		{"учётной записи нет в сервисе входа", "PATCH", "/admin/v1/employees/" + a.ID.String(), map[string]any{"last_name": "Новая"}, 409, "idp_account_missing", domain.ErrIdPAccountMissing},
		{"is_admin при создании", "POST", "/admin/v1/employees", map[string]any{"email": "x@example.com", "first_name": "А", "last_name": "Б", "is_admin": true}, 400, "validation_failed", nil},
		{"blocked при создании", "POST", "/admin/v1/employees", map[string]any{"email": "y@example.com", "first_name": "А", "last_name": "Б", "blocked": true}, 400, "validation_failed", nil},
		{"таймаут операции", "PATCH", "/admin/v1/employees/" + a.ID.String(), map[string]any{"last_name": "Новая"}, 503, "idp_unavailable", context.DeadlineExceeded},
		{"отмена операции", "PATCH", "/admin/v1/employees/" + a.ID.String(), map[string]any{"last_name": "Новая"}, 503, "idp_unavailable", context.Canceled},
		{"кривой отдел", "GET", "/admin/v1/employees?department_id=abc", nil, 400, "validation_failed", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			env.idp.err = c.idpErr
			defer func() { env.idp.err = nil }()
			status, body := call(t, env.h, c.method, c.path, userToken(a.Sub), c.body)
			require.Equal(t, c.status, status)
			require.Equal(t, c.code, body["error_code"])
		})
	}
}

func TestAdminAPI_IdPDown(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	env.idp.err = domain.ErrIdPUnavailable
	status, body := call(t, env.h, "PATCH", "/admin/v1/employees/"+a.ID.String(), userToken(a.Sub), map[string]any{"last_name": "Новая"})
	require.Equal(t, 503, status)
	require.Equal(t, "idp_unavailable", body["error_code"])
	require.NotContains(t, strings.ToLower(body["message"].(string)), "keycloak")
}

func TestReadAPI(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	status, _ := call(t, env.h, "GET", "/v1/employees", userToken(a.Sub), nil)
	require.Equal(t, 403, status)
	status, body := call(t, env.h, "GET", "/v1/employees", readerToken, nil)
	require.Equal(t, 200, status)
	require.Len(t, body["items"], 1)
	status, body = call(t, env.h, "GET", "/v1/employees/by-sub/"+a.Sub, readerToken, nil)
	require.Equal(t, 200, status)
	require.Equal(t, a.ID.String(), body["id"])
	require.Equal(t, a.Sub, body["sub"])
	status, body = call(t, env.h, "GET", "/v1/employees?updated_since=вчера", readerToken, nil)
	require.Equal(t, 400, status)
	require.Equal(t, "validation_failed", body["error_code"])
	future := url.QueryEscape(time.Now().Add(time.Hour).Format(time.RFC3339Nano))
	_, body = call(t, env.h, "GET", "/v1/employees?updated_since="+future, readerToken, nil)
	require.Empty(t, body["items"])
}

func TestReadAPI_DeletedAndDepartments(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	b := env.seed(t, "b@example.com", false)
	status, _ := call(t, env.h, "DELETE", "/admin/v1/employees/"+b.ID.String(), userToken(a.Sub), nil)
	require.Equal(t, 204, status)
	_, body := call(t, env.h, "GET", "/v1/employees", readerToken, nil)
	require.Len(t, body["items"], 1)
	_, body = call(t, env.h, "GET", "/v1/employees?include_deleted=true", readerToken, nil)
	require.Len(t, body["items"], 2)
	status, body = call(t, env.h, "GET", "/v1/employees/"+b.ID.String(), readerToken, nil)
	require.Equal(t, 200, status)
	require.NotNil(t, body["deleted_at"])
	status, _ = call(t, env.h, "GET", "/v1/employees/by-sub/none", readerToken, nil)
	require.Equal(t, 404, status)

	env.department(t, "Юристы")
	_, body = call(t, env.h, "GET", "/v1/departments", readerToken, nil)
	require.Len(t, body["items"], 1)
	status, _ = call(t, env.h, "GET", "/v1/employees", "", nil)
	require.Equal(t, 401, status)
}

func TestAdminAPI_Departments(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	tok := userToken(a.Sub)
	status, body := call(t, env.h, "POST", "/admin/v1/departments", tok, map[string]any{"name": "Юристы", "description": "Договоры"})
	require.Equal(t, 201, status)
	id := body["id"].(string)
	require.Equal(t, float64(0), body["employees_count"])
	status, body = call(t, env.h, "POST", "/admin/v1/departments", tok, map[string]any{"name": "юристы"})
	require.Equal(t, 409, status)
	require.Equal(t, "department_name_taken", body["error_code"])

	status, _ = call(t, env.h, "PATCH", "/admin/v1/employees/"+a.ID.String(), tok, map[string]any{"department_id": id})
	require.Equal(t, 200, status)
	_, body = call(t, env.h, "GET", "/admin/v1/departments", tok, nil)
	items := body["items"].([]any)
	require.Len(t, items, 1)
	require.Equal(t, float64(1), items[0].(map[string]any)["employees_count"])

	status, body = call(t, env.h, "DELETE", "/admin/v1/departments/"+id, tok, nil)
	require.Equal(t, 409, status)
	require.Equal(t, "department_not_empty", body["error_code"])

	status, body = call(t, env.h, "PATCH", "/admin/v1/departments/"+id, tok, map[string]any{"name": "Правовой"})
	require.Equal(t, 200, status)
	require.Equal(t, "Правовой", body["name"])

	status, _ = call(t, env.h, "PATCH", "/admin/v1/employees/"+a.ID.String(), tok, map[string]any{"department_id": nil})
	require.Equal(t, 200, status)
	status, _ = call(t, env.h, "DELETE", "/admin/v1/departments/"+id, tok, nil)
	require.Equal(t, 204, status)
}

func TestAdminAPI_Pagination(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	env.seed(t, "b@example.com", false)
	tok := userToken(a.Sub)
	status, body := call(t, env.h, "GET", "/admin/v1/employees?page_size=1&page=2", tok, nil)
	require.Equal(t, 200, status)
	require.Equal(t, float64(2), body["total"])
	require.Len(t, body["items"], 1)
	_, first := call(t, env.h, "GET", "/admin/v1/employees?page_size=1&page=1", tok, nil)
	require.NotEqual(t, first["items"].([]any)[0].(map[string]any)["id"], body["items"].([]any)[0].(map[string]any)["id"])

	_, body = call(t, env.h, "GET", "/admin/v1/employees", tok, nil)
	require.Len(t, body["items"], 2)

	status, _ = call(t, env.h, "GET", "/admin/v1/employees?page_size=1000", tok, nil)
	require.Equal(t, 200, status)
	require.Equal(t, 200, clampPageSize(1000))
	require.Equal(t, 50, clampPageSize(0))
	require.Equal(t, 1, clampPage(0))
}

func TestAdminAPI_ResetPasswordAndFilters(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	b := env.seed(t, "b@example.com", false)
	tok := userToken(a.Sub)
	status, body := call(t, env.h, "POST", "/admin/v1/employees/"+b.ID.String()+"/reset-password", tok, nil)
	require.Equal(t, 200, status)
	require.Equal(t, "Tmp-pass-1", body["temporary_password"])
	_, body = call(t, env.h, "GET", "/admin/v1/employees?department_id=none&status=active&q=b@", tok, nil)
	require.Equal(t, float64(1), body["total"])
	_, body = call(t, env.h, "GET", "/admin/v1/employees?status=blocked", tok, nil)
	require.Equal(t, float64(0), body["total"])
	status, _ = call(t, env.h, "DELETE", "/admin/v1/employees/"+a.ID.String(), tok, nil)
	require.Equal(t, 409, status)
}

func TestAdminAPI_PageLimit(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	tok := userToken(a.Sub)
	status, _ := call(t, env.h, "GET", "/admin/v1/employees?page=100000", tok, nil)
	require.Equal(t, 200, status)
	status, body := call(t, env.h, "GET", "/admin/v1/employees?page=100001", tok, nil)
	require.Equal(t, 400, status)
	require.Equal(t, "validation_failed", body["error_code"])
	status, body = call(t, env.h, "GET", "/admin/v1/employees?page=9223372036854775807&page_size=200", tok, nil)
	require.Equal(t, 400, status)
	require.Equal(t, "validation_failed", body["error_code"])
}

func TestAdminAPI_QueryTruncatedTo200(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	tok := userToken(a.Sub)
	pos := strings.Repeat("я", 200)
	status, _ := call(t, env.h, "PATCH", "/admin/v1/employees/"+a.ID.String(), tok, map[string]any{"position": pos})
	require.Equal(t, 200, status)
	status, body := call(t, env.h, "GET", "/admin/v1/employees?q="+url.QueryEscape(pos+"zzz"), tok, nil)
	require.Equal(t, 200, status)
	require.Equal(t, float64(1), body["total"])
}

func TestAdminAPI_SecretsNotCached(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	b := env.seed(t, "b@example.com", false)
	tok := userToken(a.Sub)
	for _, c := range []struct {
		method, path string
		body         any
		want         string
	}{
		{"POST", "/admin/v1/employees", map[string]any{"email": "n@example.com", "first_name": "Н", "last_name": "К"}, "invite_link"},
		{"POST", "/admin/v1/employees/" + b.ID.String() + "/reset-password", nil, "temporary_password"},
	} {
		req := httptest.NewRequest(c.method, c.path, bytes.NewReader(mustJSON(t, c.body)))
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		env.h.ServeHTTP(rec, req)
		require.Contains(t, []int{200, 201}, rec.Code)
		require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
		require.Contains(t, rec.Body.String(), c.want)
	}
}

func TestCreateEmployee_ReturnsInviteLink(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	status, body := call(t, env.h, "POST", "/admin/v1/employees", userToken(a.Sub), map[string]any{"email": "new@example.com", "first_name": "Анна"})
	require.Equal(t, 201, status)
	require.Contains(t, body, "invite_link")
	require.Equal(t, true, body["email_sent"])
	require.NotContains(t, body, "temporary_password")
	emp := body["employee"].(map[string]any)
	require.Equal(t, "invited", emp["status"])
	require.Equal(t, "", emp["last_name"])
	require.Equal(t, a.ID.String(), emp["invited_by"])
	require.NotNil(t, emp["invite_expires_at"])
	require.Nil(t, emp["activated_at"])
	require.Equal(t, body["invite_link"], "https://auth.test/link/"+emp["sub"].(string))
}

func TestInvite_EmptyBodyAllowed(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	tok := userToken(a.Sub)
	_, created := call(t, env.h, "POST", "/admin/v1/employees", tok, map[string]any{"email": "new@example.com", "first_name": "Анна"})
	emp := created["employee"].(map[string]any)
	path := "/admin/v1/employees/" + emp["id"].(string) + "/invite"

	status, body := call(t, env.h, "POST", path, tok, nil)
	require.Equal(t, 200, status)
	require.Contains(t, body, "invite_link")
	require.NotEqual(t, emp["sub"], body["employee"].(map[string]any)["sub"])
	require.Equal(t, emp["id"], body["employee"].(map[string]any)["id"])

	status, body = call(t, env.h, "POST", path, tok, map[string]any{"email": "fixed@example.com"})
	require.Equal(t, 200, status)
	require.Equal(t, "fixed@example.com", body["employee"].(map[string]any)["email"])

	status, body = call(t, env.h, "POST", path, tok, map[string]any{"colour": "red"})
	require.Equal(t, 400, status)
	require.Equal(t, "validation_failed", body["error_code"])
}

func TestInvite_ActiveAndNotActivatedErrors(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	active := env.seed(t, "act@example.com", false)
	invited := env.seedWith(t, "inv@example.com", func(e *domain.Employee) { e.ActivatedAt = nil })
	tok := userToken(a.Sub)

	status, body := call(t, env.h, "POST", "/admin/v1/employees/"+active.ID.String()+"/invite", tok, nil)
	require.Equal(t, 409, status)
	require.Equal(t, "already_active", body["error_code"])
	status, body = call(t, env.h, "POST", "/admin/v1/employees/"+invited.ID.String()+"/reset-password", tok, nil)
	require.Equal(t, 409, status)
	require.Equal(t, "not_activated", body["error_code"])
	status, body = call(t, env.h, "PATCH", "/admin/v1/employees/"+invited.ID.String(), tok, map[string]any{"email": "other@example.com"})
	require.Equal(t, 409, status)
	require.Equal(t, "reinvite_required", body["error_code"])
	status, _ = call(t, env.h, "DELETE", "/admin/v1/employees/"+invited.ID.String()+"?only_invited=true", tok, nil)
	require.Equal(t, 204, status)
}

func TestListEmployees_InvitedStatusFilter(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	env.seedWith(t, "inv@example.com", func(e *domain.Employee) { e.ActivatedAt = nil })
	tok := userToken(a.Sub)
	_, body := call(t, env.h, "GET", "/admin/v1/employees?status=invited", tok, nil)
	require.Equal(t, float64(1), body["total"])
	_, body = call(t, env.h, "GET", "/admin/v1/employees?status=active", tok, nil)
	require.Equal(t, float64(1), body["total"])
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	if v == nil {
		return nil
	}
	raw, err := json.Marshal(v)
	require.NoError(t, err)
	return raw
}

func TestRead_EmployeeHasNewFields(t *testing.T) {
	env := newEnv(t)
	a := env.seed(t, "a@example.com", true)
	status, body := call(t, env.h, "GET", "/v1/employees/"+a.ID.String(), readerToken, nil)
	require.Equal(t, 200, status)
	for _, k := range []string{"is_head", "status", "avatar_url", "name_confirmed"} {
		require.Contains(t, body, k)
	}
	require.Nil(t, body["avatar_url"])
	require.Equal(t, false, body["name_confirmed"])

	version := "abc"
	got := (&api{publicBaseURL: "https://admin.test/api"}).employee(domain.Employee{ID: a.ID, AvatarVersion: &version})
	require.Equal(t, "https://admin.test/api/avatars/"+a.ID.String()+"/abc.jpg", *got.AvatarURL)
}

func TestAdminAPI_HeadListsOnlyOwnDepartment(t *testing.T) {
	env := newEnv(t)
	sales, legal := env.department(t, "Продажи"), env.department(t, "Юристы")
	head := env.seedWith(t, "head@example.com", func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &sales.ID })
	env.seedWith(t, "s1@example.com", func(e *domain.Employee) { e.DepartmentID = &sales.ID })
	env.seedWith(t, "l1@example.com", func(e *domain.Employee) { e.DepartmentID = &legal.ID })
	env.seed(t, "free@example.com", false)

	status, body := call(t, env.h, "GET", "/admin/v1/employees?department_id="+legal.ID.String(), userToken(head.Sub), nil)
	require.Equal(t, 200, status)
	require.Equal(t, float64(2), body["total"])
	for _, it := range body["items"].([]any) {
		require.Equal(t, sales.ID.String(), it.(map[string]any)["department_id"])
	}
	status, body = call(t, env.h, "GET", "/admin/v1/employees?department_id=none", userToken(head.Sub), nil)
	require.Equal(t, 200, status)
	require.Equal(t, float64(2), body["total"])
}

func TestAdminAPI_BlockedHeadForbidden(t *testing.T) {
	env := newEnv(t)
	dep := env.department(t, "Продажи")
	head := env.seedWith(t, "head@example.com", func(e *domain.Employee) { e.IsHead, e.DepartmentID, e.Blocked = true, &dep.ID, true })
	target := env.seedWith(t, "t@example.com", func(e *domain.Employee) { e.DepartmentID = &dep.ID })
	status, body := call(t, env.h, "GET", "/admin/v1/employees", userToken(head.Sub), nil)
	require.Equal(t, 403, status)
	require.Equal(t, "forbidden", body["error_code"])
	status, _ = call(t, env.h, "PATCH", "/admin/v1/employees/"+target.ID.String(), userToken(head.Sub), map[string]any{"position": "x"})
	require.Equal(t, 403, status)
}

func TestAdminAPI_EmployeeForbidden(t *testing.T) {
	env := newEnv(t)
	plain := env.seed(t, "user@example.com", false)
	status, _ := call(t, env.h, "GET", "/admin/v1/employees", userToken(plain.Sub), nil)
	require.Equal(t, 403, status)
	status, body := call(t, env.h, "GET", "/admin/v1/me", userToken(plain.Sub), nil)
	require.Equal(t, 200, status)
	require.Equal(t, false, body["is_admin"])
	require.Equal(t, false, body["is_head"])
	require.Equal(t, true, body["can_confirm_name"])
}

func TestAdminAPI_HeadCannotTouchDepartments(t *testing.T) {
	env := newEnv(t)
	dep := env.department(t, "Продажи")
	head := env.seedWith(t, "head@example.com", func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &dep.ID })
	status, body := call(t, env.h, "POST", "/admin/v1/departments", userToken(head.Sub), map[string]any{"name": "Новый"})
	require.Equal(t, 403, status)
	require.Equal(t, "forbidden", body["error_code"])
	status, _ = call(t, env.h, "GET", "/admin/v1/departments", userToken(head.Sub), nil)
	require.Equal(t, 200, status)
	status, _ = call(t, env.h, "GET", "/admin/v1/me", userToken(head.Sub), nil)
	require.Equal(t, 200, status)
}

func TestAdminAPI_HeadPatchPositionOnly(t *testing.T) {
	env := newEnv(t)
	dep := env.department(t, "Продажи")
	head := env.seedWith(t, "head@example.com", func(e *domain.Employee) { e.IsHead, e.DepartmentID = true, &dep.ID })
	target := env.seedWith(t, "t@example.com", func(e *domain.Employee) { e.DepartmentID = &dep.ID })
	path := "/admin/v1/employees/" + target.ID.String()
	status, body := call(t, env.h, "PATCH", path, userToken(head.Sub), map[string]any{"position": "Менеджер", "blocked": true})
	require.Equal(t, 403, status)
	require.Equal(t, "forbidden", body["error_code"])
	status, body = call(t, env.h, "PATCH", path, userToken(head.Sub), map[string]any{"position": "Менеджер"})
	require.Equal(t, 200, status)
	require.Equal(t, "Менеджер", body["position"])
	status, _ = call(t, env.h, "GET", path, userToken(head.Sub), nil)
	require.Equal(t, 200, status)
	other := env.seed(t, "o@example.com", false)
	status, _ = call(t, env.h, "GET", "/admin/v1/employees/"+other.ID.String(), userToken(head.Sub), nil)
	require.Equal(t, 403, status)
}

func TestAdminAPI_DeleteOnlyInvited(t *testing.T) {
	env := newEnv(t)
	admin := env.seed(t, "a@example.com", true)
	active := env.seed(t, "act@example.com", false)
	status, body := call(t, env.h, "DELETE", "/admin/v1/employees/"+active.ID.String()+"?only_invited=true", userToken(admin.Sub), nil)
	require.Equal(t, 409, status)
	require.Equal(t, "already_active", body["error_code"])
	status, _ = call(t, env.h, "DELETE", "/admin/v1/employees/"+active.ID.String()+"?only_invited=maybe", userToken(admin.Sub), nil)
	require.Equal(t, 400, status)
}

func TestAuditAPI_FilterByEmployee(t *testing.T) {
	env := newEnv(t)
	admin := env.seed(t, "a@example.com", true)
	target := env.seed(t, "t@example.com", false)
	tok := userToken(admin.Sub)
	status, _ := call(t, env.h, "PATCH", "/admin/v1/employees/"+target.ID.String(), tok, map[string]any{"position": "Юрист"})
	require.Equal(t, 200, status)
	status, _ = call(t, env.h, "PATCH", "/admin/v1/employees/"+admin.ID.String(), tok, map[string]any{"position": "Директор"})
	require.Equal(t, 200, status)

	status, body := call(t, env.h, "GET", "/admin/v1/audit?employee_id="+target.ID.String(), tok, nil)
	require.Equal(t, 200, status)
	require.Equal(t, float64(1), body["total"])
	item := body["items"].([]any)[0].(map[string]any)
	require.Equal(t, "employee.update", item["action"])
	require.Equal(t, "employee", item["target_type"])
	require.Equal(t, target.ID.String(), item["target_id"])
	actorJSON := item["actor"].(map[string]any)
	require.Equal(t, "Имя", actorJSON["first_name"])
	require.Equal(t, admin.ID.String(), actorJSON["id"])
	require.Equal(t, map[string]any{"position": map[string]any{"from": "", "to": "Юрист"}}, item["details"])

	_, body = call(t, env.h, "GET", "/admin/v1/audit", tok, nil)
	require.Equal(t, float64(2), body["total"])
	status, body = call(t, env.h, "GET", "/admin/v1/audit?employee_id="+target.ID.String()+"&department_id="+uuid.NewString(), tok, nil)
	require.Equal(t, 400, status)
	require.Equal(t, "invalid", body["fields"].(map[string]any)["department_id"])
	status, _ = call(t, env.h, "GET", "/admin/v1/audit?employee_id=abc", tok, nil)
	require.Equal(t, 400, status)

	plain := env.seed(t, "p@example.com", false)
	status, _ = call(t, env.h, "GET", "/admin/v1/audit", userToken(plain.Sub), nil)
	require.Equal(t, 403, status)
}

func tinyJPEG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil))
	return buf.Bytes()
}

func rawCall(h http.Handler, method, path, token string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAvatar_PublicAndImmutable(t *testing.T) {
	env := newEnv(t)
	me := env.seed(t, "me@example.com", false)
	rec := rawCall(env.h, "PUT", "/admin/v1/me/avatar", userToken(me.Sub), tinyJPEG(t))
	require.Equal(t, 200, rec.Code)
	var first map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &first))
	firstURL := first["avatar_url"].(string)
	require.Contains(t, firstURL, "https://admin.test/api/avatars/"+me.ID.String()+"/")

	path := strings.TrimPrefix(firstURL, "https://admin.test/api")
	img := rawCall(env.h, "GET", path, "", nil)
	require.Equal(t, 200, img.Code)
	require.Equal(t, "image/jpeg", img.Header().Get("Content-Type"))
	require.Contains(t, img.Header().Get("Cache-Control"), "immutable")
	require.Contains(t, img.Header().Get("Cache-Control"), "public")
	decoded, err := jpeg.Decode(bytes.NewReader(img.Body.Bytes()))
	require.NoError(t, err)
	require.Equal(t, 8, decoded.Bounds().Dx())

	rec = rawCall(env.h, "PUT", "/admin/v1/me/avatar", userToken(me.Sub), tinyJPEG(t))
	require.Equal(t, 200, rec.Code)
	old := rawCall(env.h, "GET", path, "", nil)
	require.Equal(t, 404, old.Code)

	require.Equal(t, 404, rawCall(env.h, "GET", "/avatars/"+me.ID.String()+"/nojpg", "", nil).Code)
	require.Equal(t, 404, rawCall(env.h, "GET", "/avatars/not-a-uuid/x.jpg", "", nil).Code)
}

func TestMeAvatar_TooLarge(t *testing.T) {
	env := newEnv(t)
	me := env.seed(t, "me@example.com", false)
	for _, size := range []int{5<<20 + 1, 6 << 20} {
		rec := rawCall(env.h, "PUT", "/admin/v1/me/avatar", userToken(me.Sub), make([]byte, size))
		require.Equal(t, 400, rec.Code)
		var body map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		require.Equal(t, "too_large", body["fields"].(map[string]any)["avatar"])
	}
	rec := rawCall(env.h, "PUT", "/admin/v1/me/avatar", userToken(me.Sub), []byte("мусор"))
	require.Equal(t, 400, rec.Code)
	require.Contains(t, rec.Body.String(), `"avatar":"invalid"`)
}

func TestMeAvatar_DeleteOwnAndByAdmin(t *testing.T) {
	env := newEnv(t)
	admin := env.seed(t, "a@example.com", true)
	me := env.seed(t, "me@example.com", false)
	other := env.seed(t, "o@example.com", false)
	require.Equal(t, 200, rawCall(env.h, "PUT", "/admin/v1/me/avatar", userToken(me.Sub), tinyJPEG(t)).Code)

	status, _ := call(t, env.h, "DELETE", "/admin/v1/employees/"+me.ID.String()+"/avatar", userToken(other.Sub), nil)
	require.Equal(t, 403, status)
	status, body := call(t, env.h, "DELETE", "/admin/v1/employees/"+me.ID.String()+"/avatar", userToken(admin.Sub), nil)
	require.Equal(t, 200, status)
	require.Nil(t, body["avatar_url"])
	status, body = call(t, env.h, "DELETE", "/admin/v1/me/avatar", userToken(me.Sub), nil)
	require.Equal(t, 200, status)
	require.Nil(t, body["avatar_url"])
}

func TestMeConfirmName(t *testing.T) {
	env := newEnv(t)
	me := env.seed(t, "me@example.com", false)
	tok := userToken(me.Sub)
	status, body := call(t, env.h, "POST", "/admin/v1/me/confirm-name", tok, map[string]any{"first_name": "Анна", "last_name": ""})
	require.Equal(t, 200, status)
	require.Equal(t, "Анна", body["first_name"])
	require.Equal(t, true, body["name_confirmed"])
	status, body = call(t, env.h, "POST", "/admin/v1/me/confirm-name", tok, map[string]any{"first_name": "Другая", "last_name": ""})
	require.Equal(t, 200, status)
	require.Equal(t, "Другая", body["first_name"])
	_, body = call(t, env.h, "GET", "/admin/v1/me", tok, nil)
	require.Equal(t, true, body["can_confirm_name"])
	status, body = call(t, env.h, "POST", "/admin/v1/me/confirm-name", userToken(env.seed(t, "x@example.com", false).Sub), map[string]any{"first_name": ""})
	require.Equal(t, 400, status)
	require.Equal(t, "required", body["fields"].(map[string]any)["first_name"])
}
