package importer

import (
	"bytes"
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func user(id, email string, mut func(*keycloak.User)) keycloak.User {
	u := keycloak.User{ID: id, Username: email, Email: email, FirstName: "Имя", LastName: "Фамилия", Enabled: true}
	if mut != nil {
		mut(&u)
	}
	return u
}

func adminAI(sub string) AIRecord {
	return AIRecord{Sub: sub, EmployeeID: uuid.NewString(), Role: "ADMIN"}
}

func TestBuild(t *testing.T) {
	depts := []string{"Sales", "Юристы"}
	t.Run("отдел на каждое имя", func(t *testing.T) {
		p := Build(nil, nil, depts)
		require.Len(t, p.Departments, 2)
		require.Equal(t, "Sales", p.Departments[0].Name)
		require.NotEqual(t, uuid.Nil, p.Departments[0].ID)
		require.NotEqual(t, p.Departments[0].ID, p.Departments[1].ID)
	})
	t.Run("сервисные и без почты пропускаются", func(t *testing.T) {
		users := []keycloak.User{
			user("s1", "svc@example.com", func(u *keycloak.User) { u.Username = "service-account-svc" }),
			user("s2", "", nil),
			user("s3", "ok@example.com", nil),
		}
		p := Build(users, []AIRecord{adminAI("s3")}, depts)
		require.Len(t, p.Employees, 1)
		require.Equal(t, "ok@example.com", p.Employees[0].Email)
		require.Equal(t, "s3", p.Employees[0].Sub)
	})
	t.Run("ID из AI, затем из атрибута, затем новый", func(t *testing.T) {
		aiID, attrID := uuid.New(), uuid.New()
		users := []keycloak.User{
			user("a", "a@example.com", func(u *keycloak.User) { u.EmployeeID = uuid.NewString() }),
			user("b", "b@example.com", func(u *keycloak.User) { u.EmployeeID = attrID.String() }),
			user("c", "c@example.com", nil),
		}
		p := Build(users, []AIRecord{{Sub: "a", EmployeeID: aiID.String(), Role: "OWNER"}}, depts)
		require.Len(t, p.Employees, 3)
		require.Equal(t, aiID, p.Employees[0].ID)
		require.Equal(t, attrID, p.Employees[1].ID)
		require.NotEqual(t, uuid.Nil, p.Employees[2].ID)
		require.Contains(t, p.Warnings, "c@example.com: нет employeeId, выдан новый идентификатор")
	})
	t.Run("роли и блокировка", func(t *testing.T) {
		users := []keycloak.User{
			user("a", "a@example.com", nil),
			user("b", "b@example.com", nil),
			user("c", "c@example.com", func(u *keycloak.User) { u.Enabled = false }),
			user("d", "d@example.com", nil),
		}
		ai := []AIRecord{
			{Sub: "a", EmployeeID: uuid.NewString(), Role: "OWNER"},
			{Sub: "b", EmployeeID: uuid.NewString(), Role: "USER", Blocked: true},
			{Sub: "c", EmployeeID: uuid.NewString(), Role: "ADMIN"},
			{Sub: "d", EmployeeID: uuid.NewString(), Role: "USER"},
		}
		p := Build(users, ai, depts)
		require.True(t, p.Employees[0].IsAdmin)
		require.False(t, p.Employees[0].Blocked)
		require.False(t, p.Employees[1].IsAdmin)
		require.True(t, p.Employees[1].Blocked)
		require.True(t, p.Employees[2].IsAdmin)
		require.True(t, p.Employees[2].Blocked)
		require.False(t, p.Employees[3].IsAdmin)
		require.False(t, p.Employees[3].Blocked)
	})
	t.Run("отдел по группе", func(t *testing.T) {
		users := []keycloak.User{
			user("a", "a@example.com", func(u *keycloak.User) { u.Groups = []string{"staff", "Юристы"} }),
			user("b", "b@example.com", func(u *keycloak.User) { u.Groups = []string{"Sales", "Юристы"} }),
			user("c", "c@example.com", func(u *keycloak.User) { u.Groups = []string{"staff"} }),
		}
		p := Build(users, []AIRecord{adminAI("a")}, depts)
		require.NotNil(t, p.Employees[0].DepartmentID)
		require.Equal(t, "Юристы", departmentName(p, *p.Employees[0].DepartmentID))
		require.Nil(t, p.Employees[1].DepartmentID)
		require.Nil(t, p.Employees[2].DepartmentID)
		require.Contains(t, p.Warnings, "b@example.com: несколько отделов (Sales, Юристы), отдел не назначен")
	})
	t.Run("пустые имя и фамилия", func(t *testing.T) {
		users := []keycloak.User{user("a", "ivan.p@example.com", func(u *keycloak.User) { u.FirstName, u.LastName = "", "" })}
		p := Build(users, []AIRecord{adminAI("a")}, depts)
		require.Equal(t, "ivan.p", p.Employees[0].FirstName)
		require.Equal(t, "", p.Employees[0].LastName)
		require.Contains(t, p.Warnings, "ivan.p@example.com: пустое имя заменено на часть почты")
		require.Contains(t, p.Warnings, "ivan.p@example.com: пустая фамилия, заполните в админке")
	})
	t.Run("почта нормализуется, дубль пропускается", func(t *testing.T) {
		users := []keycloak.User{
			user("a", " Dup@Example.com ", nil),
			user("b", "dup@example.com", nil),
		}
		p := Build(users, []AIRecord{adminAI("a")}, depts)
		require.Len(t, p.Employees, 1)
		require.Equal(t, "dup@example.com", p.Employees[0].Email)
		require.Equal(t, "a", p.Employees[0].Sub)
		require.Contains(t, p.Warnings, "dup@example.com: повтор почты, учётная запись b пропущена")
	})
	t.Run("нет админов", func(t *testing.T) {
		p := Build([]keycloak.User{user("a", "a@example.com", nil)}, nil, depts)
		require.Contains(t, p.Warnings, "после переноса некому войти в админку")
	})
	t.Run("админ есть, предупреждения нет", func(t *testing.T) {
		p := Build([]keycloak.User{user("a", "a@example.com", nil)}, []AIRecord{adminAI("a")}, depts)
		require.NotContains(t, p.Warnings, "после переноса некому войти в админку")
	})
}

func TestPrint(t *testing.T) {
	users := []keycloak.User{
		user("a", "a@example.com", nil),
		user("b", "b@example.com", func(u *keycloak.User) { u.Enabled = false }),
	}
	p := Build(users, []AIRecord{adminAI("a")}, []string{"Sales"})
	var buf bytes.Buffer
	Print(&buf, p)
	out := buf.String()
	require.Contains(t, out, "Отделов: 1")
	require.Contains(t, out, "Сотрудников: 2, из них администраторов: 1, заблокированных: 1")
	require.NotContains(t, out, DryRunNotice)
	require.Equal(t, "Ничего не записано. Для применения добавьте --apply", DryRunNotice)
}

func departmentName(p Plan, id uuid.UUID) string {
	for _, d := range p.Departments {
		if d.ID == id {
			return d.Name
		}
	}
	return ""
}

func TestApply_RefusesNonEmpty(t *testing.T) {
	s := testStore(t)
	p := Build([]keycloak.User{user("a", "a@example.com", nil)}, []AIRecord{adminAI("a")}, []string{"Sales"})
	require.NoError(t, Apply(context.Background(), s, p))
	err := Apply(context.Background(), s, p)
	require.ErrorIs(t, err, ErrNotEmpty)
}

func TestApply_RefusesWhenOnlyDepartmentsExist(t *testing.T) {
	s := testStore(t)
	require.NoError(t, s.InTx(context.Background(), func(tx *store.Tx) error {
		_, err := tx.InsertDepartment(context.Background(), domain.Department{ID: uuid.New(), Name: "Sales"})
		return err
	}))
	require.ErrorIs(t, Apply(context.Background(), s, Build([]keycloak.User{user("a", "a@example.com", nil)}, []AIRecord{adminAI("a")}, []string{"Sales"})), ErrNotEmpty)
}

func TestApply_WritesPlan(t *testing.T) {
	s := testStore(t)
	users := []keycloak.User{
		user("a", "a@example.com", func(u *keycloak.User) { u.Groups = []string{"Sales"} }),
		user("b", "b@example.com", nil),
	}
	p := Build(users, []AIRecord{adminAI("a")}, []string{"Sales", "Юристы"})
	require.NoError(t, Apply(context.Background(), s, p))

	deps, err := s.ListDepartments(context.Background())
	require.NoError(t, err)
	require.Len(t, deps, 2)
	got := map[uuid.UUID]string{}
	for _, d := range deps {
		got[d.ID] = d.Name
	}
	for _, d := range p.Departments {
		require.Equal(t, d.Name, got[d.ID])
	}

	emps, total, err := s.ListEmployees(context.Background(), store.EmployeeFilter{})
	require.NoError(t, err)
	require.Equal(t, 2, total)
	byID := map[uuid.UUID]int{}
	for i, e := range emps {
		byID[e.ID] = i
	}
	for _, want := range p.Employees {
		e := emps[byID[want.ID]]
		require.Equal(t, want.Email, e.Email)
		require.Equal(t, want.Sub, e.Sub)
		require.Equal(t, want.IsAdmin, e.IsAdmin)
		require.Equal(t, want.DepartmentID, e.DepartmentID)
	}
}

func TestWithExtraAdmins(t *testing.T) {
	id := uuid.NewString()
	ai := []AIRecord{{Sub: "a", EmployeeID: id, Role: "USER", Blocked: true}, {Sub: "b", EmployeeID: uuid.NewString(), Role: "USER"}}
	got := WithExtraAdmins(ai, []string{" a ", "c", ""})
	require.Len(t, got, 3)
	require.Equal(t, AIRecord{Sub: "a", EmployeeID: id, Role: "ADMIN", Blocked: true}, got[0])
	require.Equal(t, "USER", got[1].Role)
	require.Equal(t, AIRecord{Sub: "c", Role: "ADMIN"}, got[2])
	require.Equal(t, "USER", ai[0].Role)

	users := []keycloak.User{user("a", "a@example.com", nil), user("c", "c@example.com", nil)}
	p := Build(users, WithExtraAdmins(nil, []string{"c"}), nil)
	require.False(t, p.Employees[0].IsAdmin)
	require.True(t, p.Employees[1].IsAdmin)
}

func TestApply_RefusesWithoutActiveAdmin(t *testing.T) {
	s := testStore(t)
	users := []keycloak.User{user("a", "a@example.com", nil), user("b", "b@example.com", func(u *keycloak.User) { u.Enabled = false })}
	cases := map[string]Plan{
		"нет админов":               Build(users, nil, []string{"Sales"}),
		"единственный заблокирован": Build(users, []AIRecord{adminAI("b")}, nil),
	}
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			err := Apply(context.Background(), s, p)
			require.ErrorIs(t, err, ErrNoAdmin)
			has, err := HasData(context.Background(), s)
			require.NoError(t, err)
			require.False(t, has)
		})
	}
}

func TestHasData(t *testing.T) {
	s := testStore(t)
	has, err := HasData(context.Background(), s)
	require.NoError(t, err)
	require.False(t, has)
	p := Build([]keycloak.User{user("a", "a@example.com", nil)}, []AIRecord{adminAI("a")}, nil)
	require.NoError(t, Apply(context.Background(), s, p))
	has, err = HasData(context.Background(), s)
	require.NoError(t, err)
	require.True(t, has)
}

func TestBuild_WarnsAboutMissingAdminSubs(t *testing.T) {
	users := []keycloak.User{user("a", "a@example.com", nil)}
	ai := []AIRecord{adminAI("a"), adminAI("ghost"), {Sub: "plain-ghost", Role: "USER"}}
	p := Build(users, WithExtraAdmins(ai, []string{"typo"}), nil)
	require.Contains(t, p.Warnings, "ghost: администратор из AI или --admin-subs не попал в перенос")
	require.Contains(t, p.Warnings, "typo: администратор из AI или --admin-subs не попал в перенос")
	for _, w := range p.Warnings {
		require.NotContains(t, w, "plain-ghost")
		require.NotContains(t, w, "a: администратор")
	}
}

func TestBuild_WarnsAboutAdminsOfSkippedAccounts(t *testing.T) {
	users := []keycloak.User{
		user("ok", "ok@example.com", nil),
		user("nomail", "", nil),
		user("dup", "ok@example.com", nil),
	}
	ai := []AIRecord{adminAI("ok"), adminAI("nomail"), adminAI("dup")}
	p := Build(users, ai, nil)
	require.Contains(t, p.Warnings, "nomail: администратор из AI или --admin-subs не попал в перенос")
	require.Contains(t, p.Warnings, "dup: администратор из AI или --admin-subs не попал в перенос")
	for _, w := range p.Warnings {
		require.NotContains(t, w, "ok: администратор")
	}
}

func TestBuild_WarnsAboutAccountsWithoutEmail(t *testing.T) {
	users := []keycloak.User{
		user("id-1", "", func(u *keycloak.User) { u.Username = "nomail" }),
		user("id-2", "", func(u *keycloak.User) { u.Username = "" }),
		user("s", "", func(u *keycloak.User) { u.Username = "service-account-x" }),
	}
	p := Build(users, nil, nil)
	require.Contains(t, p.Warnings, "nomail: нет почты, пропущена")
	require.Contains(t, p.Warnings, "id-2: нет почты, пропущена")
	for _, w := range p.Warnings {
		require.NotContains(t, w, "service-account")
		require.NotContains(t, w, "id-1")
	}
}

func TestBuild_DuplicateEmployeeID(t *testing.T) {
	shared := uuid.New()
	users := []keycloak.User{
		user("a", "a@example.com", func(u *keycloak.User) { u.EmployeeID = shared.String() }),
		user("b", "b@example.com", func(u *keycloak.User) { u.EmployeeID = shared.String() }),
	}
	p := Build(users, []AIRecord{{Sub: "a", Role: "ADMIN"}}, nil)
	require.Len(t, p.Employees, 2)
	require.Equal(t, shared, p.Employees[0].ID)
	require.NotEqual(t, shared, p.Employees[1].ID)
	require.NotEqual(t, uuid.Nil, p.Employees[1].ID)
	require.Contains(t, p.Warnings, "b@example.com: повтор идентификатора сотрудника "+shared.String()+", выдан новый")

	ai := []AIRecord{{Sub: "a", EmployeeID: shared.String(), Role: "ADMIN"}, {Sub: "b", EmployeeID: shared.String(), Role: "USER"}}
	p = Build(users, ai, nil)
	require.NotEqual(t, p.Employees[0].ID, p.Employees[1].ID)
}

func TestBuild_EmployeeIDMismatchTakesAI(t *testing.T) {
	aiID, attrID := uuid.New(), uuid.New()
	users := []keycloak.User{user("a", "a@example.com", func(u *keycloak.User) { u.EmployeeID = attrID.String() })}
	p := Build(users, []AIRecord{{Sub: "a", EmployeeID: aiID.String(), Role: "ADMIN"}}, nil)
	require.Equal(t, aiID, p.Employees[0].ID)
	require.Contains(t, p.Warnings, "a@example.com: employeeId в AI ("+aiID.String()+") и в учётной записи ("+attrID.String()+") расходятся, взят из AI")

	p = Build(users, []AIRecord{{Sub: "a", EmployeeID: attrID.String(), Role: "ADMIN"}}, nil)
	for _, w := range p.Warnings {
		require.NotContains(t, w, "расходятся")
	}
}

func TestBuild_SplitsFullNameFromSingleField(t *testing.T) {
	users := []keycloak.User{
		user("a", "a@example.com", func(u *keycloak.User) { u.FirstName, u.LastName = "  Иван   Петров ", "" }),
		user("b", "b@example.com", func(u *keycloak.User) { u.FirstName, u.LastName = "Анна Мария Смит", "" }),
		user("c", "c@example.com", func(u *keycloak.User) { u.FirstName, u.LastName = "Олег", "" }),
		user("d", "d@example.com", func(u *keycloak.User) { u.FirstName, u.LastName = "Пётр Первый", "Романов" }),
	}
	kept := Build(users, nil, nil)
	require.Equal(t, [2]string{"Иван Петров", ""}, [2]string{kept.Employees[0].FirstName, kept.Employees[0].LastName})
	require.Contains(t, kept.Warnings, "a@example.com: пустая фамилия, заполните в админке")

	p := BuildWithOptions(users, nil, nil, Options{SplitNames: true})
	require.Equal(t, [2]string{"Иван", "Петров"}, [2]string{p.Employees[0].FirstName, p.Employees[0].LastName})
	require.Equal(t, [2]string{"Анна", "Мария Смит"}, [2]string{p.Employees[1].FirstName, p.Employees[1].LastName})
	require.Equal(t, [2]string{"Олег", ""}, [2]string{p.Employees[2].FirstName, p.Employees[2].LastName})
	require.Equal(t, [2]string{"Пётр Первый", "Романов"}, [2]string{p.Employees[3].FirstName, p.Employees[3].LastName})
	require.Contains(t, p.Warnings, "a@example.com: полное имя из одного поля разделено на имя «Иван» и фамилию «Петров»")
	require.Contains(t, p.Warnings, "c@example.com: пустая фамилия, заполните в админке")
}
