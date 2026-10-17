# Спецификация: справочник HTTP API

Сводные контракты всех HTTP-интерфейсов системы: office API сервера ассистента, приём уведомлений, API сервиса сотрудников. Детали поведения — в [ai-server.md](ai-server.md) и [admin-api.md](admin-api.md).

## 1. Соглашения

- **Аутентификация** — токены Keycloak (`Authorization: Bearer`). Токен человека выдан публичному клиенту `admin` (PKCE); сервисные токены — клиентам `ai-admin-api` (чтение справочника), `admin-api-notify` (уведомления), `admin-api` (admin REST Keycloak). Каждый сервис проверяет подпись по JWKS, клиент (`azp`) и аудиторию.
- **Полномочия** — помимо аутентификации, office admin проверяет полномочие (`access:admin` и полномочие раздела) и сужение по отделу; `admin-api` — признаки справочника.
- **Ошибки** — JSON `{error_code, message}` (в `admin-api` также `fields` при валидации). Время — RFC3339/ISO.

## 2. Сервис сотрудников (`admin-api`)

База для браузера — `${VITE_ADMIN_API_URL}` (по умолчанию `/api`), для сервера ассистента — `ADMIN_API_URL` (`http://admin-api:8091`). Полные детали — [admin-api.md](admin-api.md), §4.

### 2.1. Публичные

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/health` | `200 ok` |
| GET | `/avatars/{id}/{version}.jpg` | JPEG, иммутабельный кэш; неверная версия — 404 |

### 2.2. Read-API для сервисов (`/v1`, клиент из `READER_CLIENTS`)

| Метод | Путь | Параметры | Ответ |
|---|---|---|---|
| GET | `/v1/employees` | `updated_since`, `include_deleted` | `{items: Employee[]}` |
| GET | `/v1/employees/{id}` | — | `Employee` |
| GET | `/v1/employees/by-sub/{sub}` | — | `Employee` |
| GET | `/v1/departments` | `updated_since`, `include_deleted` | `{items: Department[]}` |

### 2.3. Админ-API (`/admin/v1`, клиент `admin`)

| Метод | Путь | Тело / query | Ответ |
|---|---|---|---|
| GET | `/me` | — | `{employee, is_admin, is_head, can_confirm_name}` |
| POST | `/me/confirm-name` | `{first_name, last_name}` | `Employee` |
| PUT | `/me/avatar` | байты JPEG/PNG | `Employee` |
| DELETE | `/me/avatar` | — | `Employee` |
| DELETE | `/employees/{id}/avatar` | — | `Employee` |
| GET | `/employees` | `q, department_id, status, page, page_size` | `{items, total}` |
| POST | `/employees` | `{email, first_name, last_name?, position?, department_id?}` | `{employee, invite_link, email_sent}` |
| GET | `/employees/{id}` | — | `Employee` |
| PATCH | `/employees/{id}` | подмножество полей сотрудника | `Employee` |
| DELETE | `/employees/{id}` | `?only_invited=` | 204 |
| POST | `/employees/{id}/invite` | `{email?}` | `{employee, invite_link, email_sent}` |
| POST | `/employees/{id}/reset-password` | — | `{temporary_password}` |
| GET | `/audit` | `employee_id`/`department_id`, `page`, `page_size` | `{items, total}` |
| GET | `/departments` | — | `{items}` |
| POST | `/departments` | `{name, description?}` | `Department` |
| PATCH | `/departments/{id}` | `{name?, description?}` | `Department` |
| DELETE | `/departments/{id}` | — | 204 |

Коды ошибок: `forbidden` (403), `not_found` (404), `email_taken`/`department_name_taken`/`department_not_empty`/`last_admin`/`self_*`/`reinvite_required`/`already_active`/`not_activated`/`idp_account_missing` (409), `idp_rejected` (502), `idp_unavailable` (503), `validation_failed` (400).

## 3. Office API сервера ассистента

База — `${VITE_API_BASE_URL}` (по умолчанию `http://localhost:3080`). Префиксы монтирования: `/api/office/admin`, `/api/office/usage`, `/api/office/knowledge`, `/api/admin-api/notify`.

### 3.1. Admin (`/api/office/admin`, цепочка `requireAdminToken` + `access:admin`)

| Метод | Путь | Полномочие | Назначение |
|---|---|---|---|
| GET | `/me/capabilities` | — | `{capabilities[], role, departmentId, departmentName}` |
| GET | `/users` | `read:users` | список настроек AI сотрудников (`limit, offset, search, role, departmentId`) |
| GET | `/users/:id` | `read:users` | карточка (id = employeeId или userId) |
| PATCH | `/users/:id` | `manage:department_members` (+ логика) | правка настроек AI (роль/модели/лимиты — admin-level; знания — глава) |
| PATCH | `/users/:id/ai-role` | admin-level | роль `HEAD`/`USER` |
| GET | `/departments` | admin-level | список настроек AI отделов |
| PATCH | `/departments/:id` | admin-level | промпт/модели/лимиты отдела |
| GET / PUT | `/settings` | admin-level | глобальные настройки |
| GET | `/limit-requests` | `read:users` (+scope) | заявки (`?status=`) |
| POST | `/limit-requests/:id/approve` | `manage:limit_requests` | `{limits}` |
| POST | `/limit-requests/:id/reject` | `manage:limit_requests` | — |
| GET | `/spend` | `read:usage` (+scope) | журнал расходов (`from,to,userId,departmentId,model,limit,skip`) |
| GET | `/spend/requests/:messageId/transcript` | `read:usage` | переписка запроса |
| GET | `/spend/requests/:messageId/images/:fileId` | `read:usage` | сгенерированная картинка (blob) |
| GET | `/analytics` | `read:insights`/admin-level (+scope) | `groupBy=user\|department\|model\|day\|scenario` |
| GET | `/analytics/activity` | admin-level | метрики активности |
| GET | `/feedback` | admin-level | оценки (`from,to,rating,limit,skip`) |
| GET | `/provider-balance` | admin-level | баланс провайдера |
| GET | `/models` | admin-level | каталог моделей |

Knowledge (`/api/office/admin/knowledge`, `manage:knowledge_documents` + scope главы):

| Метод | Путь | Назначение |
|---|---|---|
| GET / POST | `/spaces` | список / создание раздела |
| PATCH / DELETE | `/spaces/:id` | правка / удаление (непустой — 409) |
| GET | `/spaces/:spaceId/documents` | документы раздела |
| POST | `/spaces/:spaceId/documents` | загрузка (multipart `file` + метаданные; лимит 25 МБ) |
| POST | `/spaces/:spaceId/reindex` | переиндексация (admin-level) → `{reindexed, skipped[]}` |
| PATCH / DELETE | `/documents/:id` | правка / безвозвратное удаление |

### 3.2. Usage (`/api/office/usage`, `requireJwtAuth`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/me` | суточный/месячный расход, лимит, открытые заявки |
| POST | `/request-limit` | `{window:'daily', comment}` → заявка |

### 3.3. Knowledge для сотрудника (`/api/office/knowledge`, `requireJwtAuth`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/documents/:fileId/preview` | карточка документа (pdf-метаданные / html / text) |
| GET | `/documents/:fileId/file` | скачивание оригинала (`?download=1` → attachment) |
| GET / POST | `/spaces` | список доступных / создание (при праве записи) |
| PATCH / DELETE | `/spaces/:id` | правка / удаление |
| GET / POST | `/spaces/:id/documents` | документы / загрузка (право записи, тот же конвейер `ingestDocument`) |
| PATCH | `/documents/:id` | правка своего документа |
| POST | `/documents/:id/archive` | архивирование |
| DELETE | `/documents/:id` | удаление |

### 3.4. Приём уведомлений (`POST /api/admin-api/notify`, клиент `admin-api-notify`)

Тело `{type: 'employee'\|'department', id: UUID}`. Проверяет `azp`/`aud`; при `ADMIN_API_SYNC_MODE != 'apply'` — 204 без действий; иначе читает сущность из справочника и применяет точечную синхронизацию. Ошибки справочника — 502.

## 4. Прочие эндпоинты LibreChat, используемые админ-панелью

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/models` | каталог моделей по эндпоинтам (фильтр расходов) |
| GET | `/api/roles/:roleName` | права роли (читается `permissions.MEMORIES`) |
| PUT | `/api/roles/:roleName/memories` | права памяти роли `{USE, CREATE, UPDATE, READ, OPT_OUT}` (полномочие `manage:roles`) |

## 5. Внутрикластерные вызовы (сервер↔сервисы)

| От | Кому | Назначение |
|---|---|---|
| `librechat` | `rag-api` | `/text`, `/embed`, `/query`, `/query_multiple`, `/documents` (короткоживущий JWT) |
| `librechat` | `admin-api` | `/v1/employees*`, `/v1/departments` (клиент `ai-admin-api`) |
| `admin-api` | `librechat` | `POST /api/admin-api/notify` (клиент `admin-api-notify`) |
| `admin-api` | Keycloak | admin REST, magic link (клиент `admin-api`) |
