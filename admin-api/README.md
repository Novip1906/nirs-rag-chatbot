# admin-api

Общий сервис сотрудников и отделов Corporate. Хранит имя и фамилию, почту, должность, отдел, признаки «Админ» и «Руководитель отдела», блокировку, статус приглашения, общее фото и журнал действий; отдаёт сотрудников AI-сервису чат-бота и принимает правки от людей под их собственным токеном. Данные входа (имя, почта, включена ли учётная запись, пароль) зеркалит в единый вход.

Контракт HTTP — ниже.

## Команды

| Команда | Что делает |
|---|---|
| `admin-api serve` | HTTP-сервер, самолечение зеркала и проверка приглашённых |
| `admin-api migrate` | применяет миграции базы |
| `admin-api import --ai-export users.json --departments "A,B" [--admin-subs "s1,s2"] [--split-names] [--apply]` | разовый перенос сотрудников и отделов; `--admin-subs` — кто получает признак администратора сверх админов AI; без `--apply` только печатает план |
| `admin-api set-heads --file heads.json [--apply]` | разовый перенос руководителей отделов из AI: файл — JSON-массив объектов с полем `employee_id` (лишние поля вроде `email` и `department` игнорируются); ставит признак «Руководитель отдела» тем, у кого есть отдел; без `--apply` ничего не меняет, отчёт `{set, already_set, no_department, not_found}` печатает в stdout; с `--apply` выходит с ненулевым кодом, если `not_found` или `no_department` не пусты (отчёт при этом печатается, найденным признак проставлен) |

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `HTTP_ADDR` | `:8091` | адрес сервера |
| `PUBLIC_BASE_URL` | обязательна | внешний адрес сервиса вместе с префиксом пути, например `https://admin.example.com/api`; из него строятся `avatar_url`; хвостовой `/` срезается |
| `POSTGRES_DSN` | обязательна | база |
| `KEYCLOAK_ISSUER` | обязательна | издатель токенов |
| `KEYCLOAK_JWKS_URL` | обязательна | ключи подписи |
| `KEYCLOAK_AUDIENCE` | `admin-api` | ожидаемая аудитория токенов |
| `READER_CLIENTS` | пусто | сервисные клиенты, которым разрешено чтение, через запятую; токен такого клиента с claim `sid` (вход человека) читать не может |
| `ADMIN_CLIENTS` | `admin` | клиенты, через которые входят люди (`azp`) на маршрутах `/admin/v1/*`; токен другого клиента получает 401 |
| `KEYCLOAK_ADMIN_URL`, `KEYCLOAK_REALM` | обязательны | admin REST единого входа |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `admin-api` | сервисный клиент для записи учётных записей |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | обязательна | его секрет |
| `NOTIFY_URLS` | пусто | адреса получателей уведомлений (AI-сервиса), через запятую |
| `NOTIFY_CLIENT_ID` | `admin-api-notify` | клиент без ролей, токен которого уходит получателям уведомлений (`client_credentials` на `KEYCLOAK_ADMIN_URL/realms/<realm>/protocol/openid-connect/token`) |
| `NOTIFY_CLIENT_SECRET` | обязательна, если задан `NOTIFY_URLS` | его секрет; без неё сервис не стартует |
| `RECONCILE_INTERVAL` | `5m` | период самолечения: `0` выключает, иначе не меньше `1m` |
| `RECONCILE_MAX_DISABLES` | `5` | порог выключений учётных записей за проход, не меньше `0` |
| `RECONCILE_MAX_ENABLES` | `5` | порог включений учётных записей за проход, не меньше `0`; при превышении проход ничего не применяет |
| `INVITE_CLIENT_ID` | обязательна | клиент единого входа, в который ведёт ссылка-приглашение (клиент чата `librechat`) |
| `INVITE_REDIRECT_URL` | обязательна | куда человек попадает после задания пароля: адрес входа в чат, разрешённый у клиента, например `https://ai.example.com/login` |
| `INVITE_TTL` | `168h` | срок жизни ссылки-приглашения, не меньше `1m` |
| `ACTIVATION_INTERVAL` | `30s` | как часто сервис спрашивает единый вход, задали ли приглашённые пароль, не меньше `1s` |

## Контракт

```
Employee   {id, sub, email, first_name, last_name, position, department_id|null,
            is_admin, is_head, blocked,
            status: "invited" | "invite_expired" | "active" | "blocked",
            avatar_url|null,
            invited_at|null, invite_expires_at|null, invited_by|null, activated_at|null,
            name_confirmed: bool,
            created_at, updated_at, deleted_at|null}
Department {id, name, description, employees_count, created_at, updated_at, deleted_at|null}
AuditEntry {id, at, actor: {id, first_name, last_name}|null, action, target_type: "employee"|"department",
            target_id, details: object}
Error      {error_code, message, fields?: {<field>: <reason>}}
```

- `status`: `blocked`, если `blocked`; иначе `active`, если `activated_at` задано; иначе `invite_expired`, если `invite_expires_at` в прошлом; иначе `invited`.
- `avatar_url` — абсолютный адрес `{PUBLIC_BASE_URL}/avatars/{id}/{version}.jpg`; меняется при каждой загрузке.
- `last_name` может быть пустой строкой.
- **`sub` у не вошедшего сотрудника может смениться** (повторное приглашение пересоздаёт учётку входа). Потребители сопоставляют сотрудника по `id`.
- Уведомления `POST {type, id}` уходят при любом изменении сотрудника или отдела, в том числе при активации, смене фото и подтверждении имени.
- Удаление мягкое. Поля в ответах только добавляются, не убираются; единственное исключение — `temporary_password` в ответе создания.

### Чтение для сервисов

`GET /v1/employees`, `/v1/employees/{id}`, `/v1/employees/by-sub/{sub}`, `/v1/departments` — сервисный токен из `READER_CLIENTS`; пути прежние, в `Employee` добавились поля.

### Картинка, без входа

| Метод и путь | Ответ |
|---|---|
| `GET /avatars/{id}/{version}.jpg` | `image/jpeg`, `Cache-Control: public, max-age=31536000, immutable`; чужая или старая версия — 404 |

### Для вошедшего человека

`/admin/v1/…`, токен человека, `azp` из `ADMIN_CLIENTS`. «Руководитель» — сотрудник с `is_head` и отделом, «свой» — сотрудник того же отдела. Заблокированный и удалённый получают 403 на всё, кроме `GET /admin/v1/me`: он отвечает 200, у заблокированного `is_admin` и `is_head` ложны, а `employee.status` равен `blocked`.

| Метод и путь | Кому | Тело → ответ |
|---|---|---|
| `GET /admin/v1/me` | любой вошедший | → `{employee\|null, is_admin, is_head, can_confirm_name}` |
| `POST /admin/v1/me/confirm-name` | сам | `{first_name, last_name}` → `Employee`; можно вызывать повторно |
| `PUT /admin/v1/me/avatar` | сам | тело — файл `image/jpeg` или `image/png` до 5 МБ и 16 млн точек → `Employee`; иначе 400 `fields.avatar`: `invalid` \| `too_large` |
| `DELETE /admin/v1/me/avatar` | сам | → `Employee` |
| `GET /admin/v1/employees?q=&department_id=&status=&page=&page_size=` | админ; руководитель — только свой отдел, фильтр подставляется сам | → `{items, total}`; `status`: `active` \| `blocked` \| `invited` (включая истёкшие) |
| `POST /admin/v1/employees` | админ; руководитель — только в свой отдел | `{email, first_name, last_name?, position?, department_id?}` → 201 `{employee, invite_link, email_sent}` |
| `POST /admin/v1/employees/{id}/invite` | админ; руководитель — своего, кроме админов и руководителей | `{email?}` (тело необязательно) → `{employee, invite_link, email_sent}`; вошедшему — 409 `already_active` |
| `GET /admin/v1/employees/{id}` | админ; руководитель — своего | → `Employee` |
| `PATCH /admin/v1/employees/{id}` | админ — любые поля; руководитель — только `position` у своего | подмножество `{email, first_name, last_name, position, department_id, is_admin, is_head, blocked}` → `Employee` |
| `DELETE /admin/v1/employees/{id}?only_invited=true` | админ; руководитель — только не вошедшего своего, кроме админов и руководителей | → 204; с `only_invited=true` вошедшего не удаляет — 409 `already_active` («Отозвать приглашение») |
| `POST /admin/v1/employees/{id}/reset-password` | админ | → `{temporary_password}`; не вошедшему — 409 `not_activated` |
| `DELETE /admin/v1/employees/{id}/avatar` | админ | → `Employee` |
| `GET /admin/v1/departments` | админ, руководитель | как раньше |
| `POST`, `PATCH`, `DELETE /admin/v1/departments…` | админ | как раньше |
| `GET /admin/v1/audit?employee_id=&department_id=&page=&page_size=` | админ | → `{items: AuditEntry[], total}`, новые сверху; оба фильтра сразу — 400 `fields.department_id = invalid` |

Правила:

- Нет права на действие или на одно из полей запроса — 403 `forbidden`, ничего не меняется.
- `is_head: true` сотруднику без отдела — 400 `fields.is_head = no_department`. Смена или снятие отдела без явного `is_head` сбрасывает `is_head`.
- `email` у не вошедшего через `PATCH` не меняется — 409 `reinvite_required`; почту меняет `POST …/invite` с полем `email`.
- `email_sent: false` — письмо не ушло, ссылка при этом рабочая.
- Удаление не вошедшего, который успел задать пароль: сотрудник становится активным; с `only_invited=true` — 409 `already_active`, без него руководителю — 403 `forbidden`, админ удаляет.
- Ссылка одноразовая и живёт `INVITE_TTL`. Повторное приглашение пересоздаёт учётку входа: прежние ссылки перестают работать, `id` сотрудника остаётся, `sub` меняется.
- «Приглашён» становится «Активен», когда единый вход сообщает, что пароль задан; сервис проверяет это раз в `ACTIVATION_INTERVAL`.

Действия журнала: `employee.invite`, `employee.reinvite` (`details.email` — строка, а при смене почты `{from, to}`), `employee.update` (`details` — `{<поле>: {from, to}}`), `employee.delete`, `employee.reset_password`, `employee.confirm_name`, `employee.avatar_remove`, `department.create`, `department.update`, `department.delete`.

## Проверки

```
go vet ./...
go test -p 1 ./...
```

Тесты поднимают Postgres через testcontainers, нужен Docker. Пакеты запускаются по очереди (`-p 1`): при параллельном запуске контейнеры конфликтуют.

## Чтение изменений

`updated_since` подходит для ускорения полного прохода, но не для строго инкрементального чтения: `updated_at` записи ставится чуть раньше, чем правка становится видна читателям (внутри той же операции идёт запись в единый вход). Потребитель, который хранит метку последнего чтения, должен отступать от неё назад не меньше чем на минуту либо периодически читать список целиком. AI читает список целиком.

## Развёртывание

Базовые манифесты — в `deploy/`, адреса и переменные окружения задаёт корневой оверлей [`../deploy`](../deploy/README.md): без `PUBLIC_BASE_URL`, `INVITE_CLIENT_ID`, `INVITE_REDIRECT_URL` и адресов единого входа `serve` завершается на старте. Лимит памяти контейнера — 384Mi при `GOMEMLIMIT=300MiB`; фото обрабатываются строго по одному. Секрет `admin-api` (пароль базы и секреты клиентов `admin-api`, `admin-api-notify`) создаёт `deploy/make-secrets.sh` корневого оверлея.

Единый вход: у клиента админ-панели `admin` должны быть аудитории `admin-api` и `corporate-ai`, у клиента `admin-api-notify` — аудитория `corporate-ai`, у сервисного клиента `admin-api` — роль `manage-users`, а расширение magic-link — загружено (`GET /realms/<realm>/magic-link` отвечает не 404). Всё это уже описано в `deploy/realm-corporate.json`.

`HTTP_PATH_PREFIX` задаёт путь, под которым сервис виден снаружи (в оверлее `/api`); запросы без префикса изнутри сети тоже принимаются.
