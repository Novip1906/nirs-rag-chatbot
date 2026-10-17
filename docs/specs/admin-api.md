# Спецификация: сервис сотрудников (admin-api)

Go-сервис — справочник сотрудников и отделов. Ведёт учётные записи, зеркалирует их в Keycloak, рассылает приглашения, хранит фото и журнал действий, уведомляет сервер ассистента об изменениях и чинит расхождения зеркала. Реализация — `admin-api/`.

Смежные документы: [data-model.md](data-model.md) (таблицы PostgreSQL), [api-reference.md](api-reference.md) (сводные контракты), [deployment.md](deployment.md) (манифесты и секреты).

## 1. Технологии

- Go **1.26**, модуль `github.com/Novip1906/nirs-rag-chatbot/admin-api`.
- Маршрутизация — стандартный `net/http` (`http.ServeMux` с шаблонами `METHOD /path/{param}`). Логирование — `log/slog`.
- PostgreSQL через `jackc/pgx/v5` (`stdlib`, `database/sql`, `SetMaxOpenConns(10)`); миграции — `pressly/goose/v3` с `//go:embed migrations/*.sql`.
- Проверка JWT — `go-jose/go-jose/v4`; обработка фото — `disintegration/imaging`; идентификаторы — `google/uuid`.
- Тесты — `testify`, Postgres поднимается через `testcontainers-go` (нужен Docker); запуск `go test -p 1 ./...`.
- Сборка: `golang:1.26-bookworm`, `CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`; рантайм-образ `gcr.io/distroless/static-debian12:nonroot`, `EXPOSE 8091`, `CMD ["serve"]`.

## 2. Доменная модель

### Сотрудник (`Employee`)

`ID uuid`, `Sub`, `Email`, `FirstName`, `LastName`, `Position`, `DepartmentID *uuid`, `IsAdmin`, `IsHead`, `Blocked`, `InvitedAt`, `InviteExpiresAt`, `InvitedBy *uuid`, `ActivatedAt`, `NameConfirmedAt`, `AvatarVersion *string`, `CreatedAt`, `UpdatedAt`, `DeletedAt`.

Статус вычисляется на момент запроса по порядку: `blocked` (если заблокирован) → `active` (если задан `ActivatedAt`) → `invite_expired` (если истёк `InviteExpiresAt`) → `invited`.

Предикаты:

- `Active = !Blocked && DeletedAt == nil`;
- `Admin = IsAdmin && Active`;
- `Head = IsHead && DepartmentID != nil && Active`;
- `HeadOf(target) = Head && отделы совпадают`.

### Отдел (`Department`)

`ID`, `Name`, `Description`, `EmployeesCount` (число неудалённых сотрудников), `CreatedAt`, `UpdatedAt`, `DeletedAt`.

### Запись журнала (`AuditEntry`)

`ID int64`, `At`, `ActorID *uuid` (+ имя/фамилия актора при чтении), `Action`, `TargetType` (`employee` | `department`), `TargetID`, `Details map[string]any` (diff вида `{поле: {from, to}}`).

Действия: `employee.invite`, `employee.reinvite`, `employee.update`, `employee.delete`, `employee.reset_password`, `employee.confirm_name`, `employee.avatar_remove`, `department.create`, `department.update`, `department.delete`.

## 3. Права

«Актор» — сотрудник, найденный по `sub` из токена. «Свой» — сотрудник того же отдела.

| Действие | Сотрудник | Руководитель | Админ |
|---|---|---|---|
| `GET /admin/v1/me` | + | + | + |
| Подтвердить имя, загрузить/удалить своё фото | + | + | + |
| Список и карточка сотрудников | – | свой отдел | + |
| Создать и пригласить | – | только в свой отдел | + |
| Повторное приглашение | – | свой, кроме админов и руководителей | + |
| Изменить должность | – | у своего | + |
| Изменить почту, имя, отдел, признаки, блокировку | – | – | + |
| Удалить сотрудника | – | только не вошедшего своего (кроме админов и руководителей) | + |
| Сбросить пароль (временный) | – | – | + |
| Удалить чужое фото | – | – | + |
| Список отделов | – | + | + |
| Создать/изменить/удалить отдел | – | – | + |
| Журнал действий | – | – | + |

Защитные правила (проверяются на сервере):

- нельзя снять права у последнего активного администратора — перед операцией берётся `pg_advisory_xact_lock(7261004001)`, активные админы считаются как `is_admin AND NOT blocked AND activated_at IS NOT NULL AND deleted_at IS NULL`; при ≤1 — ошибка `last_admin`;
- нельзя снять признак «Админ» с самого себя (`self_admin_revoke`) и заблокировать самого себя (`self_block`);
- нельзя удалить самого себя (`self_delete`);
- `is_head=true` без отдела отклоняется (`fields.is_head=no_department`); смена/снятие отдела без явного `is_head` сбрасывает признак руководителя.

## 4. HTTP API

Общие правила:

- Префикс пути из `HTTP_PATH_PREFIX` (пусто — без префикса; запросы без префикса изнутри сети принимаются). Ошибки — JSON `{"error_code","message"}`; валидация — 400 `{"error_code":"validation_failed","message":"Данные не прошли проверку","fields":{…}}`. Время — RFC3339Nano UTC.
- Тело запроса: лимит 1 МиБ, `DisallowUnknownFields`, лишние токены после объекта запрещены; нарушение — 400 `fields.body=invalid`.
- Пагинация: `page` (по умолчанию 1, максимум 100000), `page_size` (по умолчанию 50, максимум 200). `q` обрезается до 200 рун. Не-UUID в `{id}` — 404.

### 4.1. Публичные

| Метод и путь | Ответ |
|---|---|
| `GET /health` | 200, тело `ok` |
| `GET /avatars/{id}/{version}.jpg` | 200 `image/jpeg`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. Неверная/старая версия, удалённый сотрудник — 404 |

### 4.2. Read-маршруты для сервисов (`/v1/…`)

Доступны по токену сервисного клиента из `READER_CLIENTS` (claim `azp` входит в список, нет `sid`). Токен человека — 403. Возвращают всех, включая удалённых (при `include_deleted=true`), без фильтров прав; поддерживают инкрементальное чтение.

| Маршрут | Параметры | Ответ |
|---|---|---|
| `GET /v1/employees` | `updated_since` (RFC3339Nano, условие `updated_at >= since`), `include_deleted` | `{items: Employee[]}`, сортировка `updated_at, id` |
| `GET /v1/employees/{id}` | — | `Employee` (с `deleted_at`), иначе 404 |
| `GET /v1/employees/by-sub/{sub}` | — | `Employee`, иначе 404 |
| `GET /v1/departments` | `updated_since`, `include_deleted` | `{items: Department[]}` |

### 4.3. Админ-маршруты (`/admin/v1/…`)

Цепочка: `RequireUser` (токен человека, `azp` из `ADMIN_CLIENTS`, по умолчанию `admin`) → `requireActor` (поиск по `sub`; нет записи, заблокирован или удалён — 403). Исключение — `GET /admin/v1/me`, который обходит `requireActor`.

| Метод и путь | Кому | Тело | Ответ |
|---|---|---|---|
| `GET /admin/v1/me` | любой валидный токен | — | `{employee, is_admin, is_head, can_confirm_name}` (поля `null`/`false`, если записи нет) |
| `POST /admin/v1/me/confirm-name` | сам (активный) | `{first_name, last_name}` | `Employee` |
| `PUT /admin/v1/me/avatar` | сам (активный) | сырые байты JPEG/PNG (≤5 МиБ) | `Employee` |
| `DELETE /admin/v1/me/avatar` | сам (активный) | — | `Employee` |
| `DELETE /admin/v1/employees/{id}/avatar` | админ | — | `Employee` |
| `GET /admin/v1/employees` | админ; руководитель — свой отдел | query `q, department_id, status, page, page_size` | `{items, total}` |
| `POST /admin/v1/employees` | админ; руководитель — в свой отдел | `{email, first_name, last_name?, position?, department_id?}` | 201 `{employee, invite_link, email_sent}`, `Cache-Control: no-store` |
| `GET /admin/v1/employees/{id}` | админ; руководитель — своего | — | `Employee` (удалённый — 404) |
| `PATCH /admin/v1/employees/{id}` | админ — любые поля; руководитель — только `position` своего | подмножество `{email, first_name, last_name, position, department_id, is_admin, is_head, blocked}` | `Employee` |
| `DELETE /admin/v1/employees/{id}` | см. §3 | query `only_invited=true\|false` | 204 |
| `POST /admin/v1/employees/{id}/invite` | админ; руководитель — своего, кроме админов/руководителей | `{email?}` (тело необязательно) | `{employee, invite_link, email_sent}`, `no-store` |
| `POST /admin/v1/employees/{id}/reset-password` | только админ | — | `{temporary_password}`, `no-store` |
| `GET /admin/v1/audit` | только админ | query `employee_id`/`department_id`, `page`, `page_size` | `{items, total}`, сортировка `id DESC` |
| `GET /admin/v1/departments` | админ или руководитель | — | `{items}`, сортировка `lower(name), id` |
| `POST /admin/v1/departments` | только админ | `{name, description?}` | 201 `Department` |
| `PATCH /admin/v1/departments/{id}` | только админ | `{name?, description?}` | `Department` |
| `DELETE /admin/v1/departments/{id}` | только админ | — | 204 |

Особенности:

- `department_id` в теле — «трёхзначное» поле: отсутствует (не менять), `null` (снять отдел), не-UUID (`fields.department_id=invalid`), несуществующий (`unknown`).
- Фильтр списка: `status ∈ {"", active, blocked, invited}` (invited включает истёкшие); `department_id` — UUID или `none`; у руководителя отдел подставляется принудительно; `q` — `ILIKE` по имени, фамилии, почте, должности. Удалённые не выводятся.
- `PATCH` почты у не вошедшего (`activated_at == nil`) запрещён: `reinvite_required` (почту меняет только повторное приглашение).
- Валидация (длины в рунах): имя/фамилия ≤100, `position` ≤200, `email` ≤254 (`net/mail`, нижний регистр), `department.name` ≤120, `description` ≤500. `first_name` обязателен.

### 4.4. Коды ошибок

| HTTP | `error_code` | Когда |
|---|---|---|
| 403 | `forbidden` | недостаточно прав |
| 404 | `not_found` | запись не найдена |
| 409 | `email_taken` | почта занята |
| 409 | `department_name_taken` | имя отдела занято |
| 409 | `department_not_empty` | в отделе есть сотрудники |
| 409 | `last_admin` | последний администратор |
| 409 | `self_admin_revoke` / `self_block` / `self_delete` | операция над собой |
| 409 | `reinvite_required` | смена почты не вошедшего |
| 409 | `already_active` / `not_activated` | состояние приглашения |
| 409 | `idp_account_missing` | нет учётной записи входа |
| 502 | `idp_rejected` | Keycloak отклонил изменение |
| 503 | `idp_unavailable` | Keycloak недоступен (сюда же таймаут/отмена) |
| 401 | `unauthorized` | нет/невалидный токен |
| 500 | `internal` | прочее |

## 5. Операции над учётными записями

Операции идут на отсоединённом контексте (`context.WithoutCancel`), таймаут 30 с, компенсация 10 с. Каждое успешное изменение вызывает `Notifier.EmployeeChanged(id)` / `DepartmentChanged(id)`. Если после применения ничего не изменилось, запись не сохраняется и уведомления нет.

**Создание и приглашение.** В Keycloak создаётся пользователь с `requiredActions:["UPDATE_PASSWORD"]`, `emailVerified:true`, атрибутом `employeeId`. При 409 ищется «сирота» по почте и пересоздаётся, только если у него нет пароля и его `employeeId` не принадлежит другому сотруднику. Далее в транзакции: вставка сотрудника (`invited_at=now`, `invite_expires_at=now+InviteTTL`, `invited_by`), аудит `employee.invite`, выдача magic link. При любой ошибке учётная запись в Keycloak удаляется (компенсация).

**Повторное приглашение.** Старая учётная запись Keycloak удаляется, создаётся новая (новый `sub`), обновляются `invited_at`/`invite_expires_at`/`invited_by`; прежние ссылки перестают работать, `employeeId` сохраняется. Аудит `employee.reinvite`. Если сотрудник уже вошёл — `already_active`.

**Сброс пароля.** Только админ. Генерируется пароль формата `XXXX-XXXX-XXXX` (алфавит без похожих символов, гарантированно есть цифра, строчная и заглавная), ставится в Keycloak как временный (`temporary:true`), аудит `employee.reset_password`, затем `Logout`. Временный пароль показывается один раз.

**Блокировка.** `PATCH blocked:true` после коммита вызывает `Logout` в Keycloak (завершение сессий).

**Удаление.** Мягкое (`deleted_at`). Нельзя удалить себя; админов/руководителей руководитель удалить не может; при `only_invited=true` вошедшего — `already_active`. Если не вошедший успел задать пароль, он помечается активным (а не удаляется). Аудит `employee.delete`, затем `DeleteUser` в Keycloak внутри транзакции (ошибка откатывает).

**Профиль в Keycloak.** `UpdateUser` переносит `email`, `firstName`, `lastName`, `enabled = !blocked`, только при реальном изменении.

## 6. Интеграция с Keycloak

- Admin REST: `{KEYCLOAK_ADMIN_URL}/admin/realms/{realm}{path}`, таймаут 10 с; при 401 токен сбрасывается и запрос повторяется один раз. 404 → `idp_account_missing`; 401/403/≥500/сеть → `idp_unavailable`; прочие не-2xx → `idp_rejected`.
- Сервисный токен: `client_credentials` на `{adminURL}/realms/{realm}/protocol/openid-connect/token`, кэш в памяти со сроком `expires_in − 30 с`.
- Вызовы: `POST /users` (создание), `GET`+`PUT /users/{sub}` (профиль), `PUT /users/{sub}/reset-password`, `POST /users/{sub}/logout`, `DELETE /users/{sub}`, `GET /users/{sub}/credentials` (проверка «пароль задан»), `GET /users?exact=true&email=…` (поиск). `sub` берётся из заголовка `Location` ответа создания.
- Magic link: `POST {baseURL}/realms/{realm}/magic-link` (расширение Keycloak) с `client_id=INVITE_CLIENT_ID`, `redirect_uri=INVITE_REDIRECT_URL`, `expiration_seconds=INVITE_TTL`, `reusable:false`, `remember_me:true`, `send_email:true`. Ответ `{user_id, link, sent}`; сервис возвращает `invite_link` и `email_sent`.

## 7. Проверка JWT

- Алгоритмы RS256/ES256; ровно одна подпись; обязателен `kid`. JWKS кэшируется 30 минут; при неизвестном `kid` — принудительное обновление с cooldown 30 с; при ошибке используется кэш.
- Claims: `exp` обязателен, `nbf` с допуском 30 с, `iss` сверяется с `KEYCLOAK_ISSUER`, `sub` непуст. Аудитория: `aud` должна содержать `KEYCLOAK_AUDIENCE` (по умолчанию `admin-api`).
- Разделение токенов: **сервисный** — `azp != "" && sid == "" && azp ∈ READER_CLIENTS`; иначе **человек**. `RequireUser` (на `/admin/v1`) отклоняет сервисные токены и чужие `azp`; `RequireReader` (на `/v1`) отклоняет токены человека.

## 8. Фоновые процессы

**Активация приглашённых** (`ACTIVATION_INTERVAL`, по умолчанию 30 с). Для каждого не вошедшего проверяется наличие пароля в Keycloak; при наличии в транзакции под блокировкой выставляется `activated_at=now`, затем уведомление.

**Самолечение зеркала** (`RECONCILE_INTERVAL`, по умолчанию 5 мин, 0 — выключено; первый запуск через 30 с). Для каждого неудалённого сотрудника читается профиль Keycloak; расхождения по почте/имени/`enabled` исправляются по БД (источник истины). **Порог безопасности**: если за проход нужно выключить больше `RECONCILE_MAX_DISABLES` (5) или включить больше `RECONCILE_MAX_ENABLES` (5) учётных записей — проход пропускается целиком. Недавно (моложе 60 с) изменённые записи пропускаются.

**Уведомления** (`Notifier`). На каждую цель из `NOTIFY_URLS` — `POST {"type":"employee"|"department","id":"<uuid>"}` с токеном клиента `NOTIFY_CLIENT_ID` (по умолчанию `admin-api-notify`), таймаут 3 с, без повторов. Отправляются при любом изменении, включая активацию, фото, подтверждение имени и удаление.

## 9. Фото

Вход — JPEG/PNG до 5 МиБ и 16 млн точек. Обработка строго по одному за раз: авто-ориентация, вписывание в 512×512 (Lanczos, пропорции сохраняются), прозрачность заливается белым, кодирование в JPEG качества 85. Хранится в `employee_avatars.content` (bytea), одна строка на сотрудника; в `employees.avatar_version` — случайный hex-токен (32 символа). Отдаётся без аутентификации по `GET /avatars/{id}/{version}.jpg` с иммутабельным кэшем на год; URL меняется при каждой загрузке.

## 10. Команды CLI

`admin-api serve|migrate|import|set-heads`.

- `serve` — HTTP-сервер, циклы активации и самолечения.
- `migrate` — применяет миграции goose (нужен только `POSTGRES_DSN`); в кластере запускается init-контейнером.
- `import` — разовый перенос из Keycloak в БД. Флаги: `--ai-export`, `--departments`, `--admin-subs`, `--split-names`, `--apply`. Без `--apply` печатает план и ничего не пишет; отказывается применяться, если база не пуста или не остаётся активного админа.
- `set-heads` — разовая простановка признака руководителя из JSON-файла `{employee_id}`. Флаги `--file` (обязателен), `--apply`. Отчёт `{set, already_set, no_department, not_found}`.

## 11. Конфигурация

| Переменная | Дефолт | Обязательна |
|---|---|---|
| `HTTP_ADDR` | `:8091` | нет |
| `HTTP_PATH_PREFIX` | `""` | нет |
| `PUBLIC_BASE_URL` | — | да |
| `POSTGRES_DSN` | — | да |
| `KEYCLOAK_ISSUER` / `KEYCLOAK_JWKS_URL` | — | да |
| `KEYCLOAK_AUDIENCE` | `admin-api` | нет |
| `READER_CLIENTS` | пусто | нет |
| `ADMIN_CLIENTS` | `admin` | нет |
| `KEYCLOAK_ADMIN_URL` / `KEYCLOAK_REALM` | — | да |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `admin-api` | нет |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | — | да |
| `NOTIFY_URLS` | пусто | нет |
| `NOTIFY_CLIENT_ID` | `admin-api-notify` | нет |
| `NOTIFY_CLIENT_SECRET` | — | да при `NOTIFY_URLS` |
| `INVITE_CLIENT_ID` / `INVITE_REDIRECT_URL` | — | да |
| `INVITE_TTL` | `168h` | нет |
| `ACTIVATION_INTERVAL` | `30s` | нет |
| `RECONCILE_INTERVAL` | `5m` | нет |
| `RECONCILE_MAX_DISABLES` / `RECONCILE_MAX_ENABLES` | `5` | нет |

Лимит памяти контейнера (384Mi, `GOMEMLIMIT=300MiB`) задаётся манифестами `deploy/`.
