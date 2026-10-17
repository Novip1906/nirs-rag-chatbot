# Спецификация: админ-панель (admin-ui)

Веб-интерфейс администратора и руководителей отделов. Собственных данных не хранит: ходит в сервер ассистента (office API) и в сервис сотрудников (`admin-api`) с токеном Keycloak пользователя. Реализация — `admin-ui/`.

Смежные документы: [api-reference.md](api-reference.md) (контракты вызываемых эндпоинтов), [ai-server.md](ai-server.md) (серверные полномочия), [admin-api.md](admin-api.md) (справочник).

## 1. Технологии и сборка

| Параметр | Значение |
|---|---|
| Менеджер пакетов | npm (`npm ci`), ES-модули |
| Ядро | React 18.3, TypeScript 5.9, Vite 8 (`@vitejs/plugin-react`) |
| Роутер | `react-router-dom` 7 (`BrowserRouter`, `Routes`, `Outlet`, `NavLink`) |
| Серверное состояние | `@tanstack/react-query` 4 (один `QueryClient`) |
| HTTP | `axios` (один инстанс с интерсепторами) |
| UI | Radix UI, `@ariakit/react`, `lucide-react`, `class-variance-authority`, `tailwind-merge`, `react-markdown` + `remark-gfm` |
| Стили | Tailwind 3.4 (`darkMode: ['class']`), токены-переменные в `src/index.css` (`:root` / `.dark`) |
| Скрипты | `dev`=`vite`, `build`=`tsc --noEmit && vite build`, `lint`=`oxlint`, `test`=`jest` (jsdom) |

Алиасы сборки: `~` → `src`, `@librechat/client` → `src/ui` (локальная дизайн-система: Alert, Button, Table, Dialog, Select, MultiSelect, Tag, Toast, Spinner и др.).

Dockerfile двухэтапный: `node:24-alpine` (`npm ci`, `npm run build`) → `nginx:1.27-alpine` (`dist` в `/usr/share/nginx/html`, порт 80). `nginx.conf`: SPA-fallback `try_files $uri $uri/ /index.html`, `GET /health` → `200 ok`. Проксирования API нет — браузер ходит в сервисы напрямую через ingress.

Переменные сборки (build-args Vite):

| Переменная | Умолчание | Назначение |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3080` | база office API сервера ассистента |
| `VITE_ADMIN_API_URL` | `/api` | база сервиса сотрудников |
| `VITE_CHAT_URL` | `http://localhost:3090` | адрес чата (ссылки «открыть чат») |
| `VITE_OIDC_ISSUER` | `http://localhost:8080/realms/corporate` | issuer Keycloak |
| `VITE_OIDC_CLIENT_ID` | `admin` | публичный клиент админ-панели |

`index.html`: `lang="ru"`, title «Corporate Admin», встроенный скрипт до отрисовки читает `localStorage.theme` и ставит класс `dark`. Дерево провайдеров: `QueryClientProvider → ThemeProvider → LocaleProvider → ToastProvider → BrowserRouter → AuthProvider → Routes`.

## 2. Аутентификация (OIDC Authorization Code + PKCE, в браузере)

Панель сама выполняет код-обмен у Keycloak (публичный клиент `admin`), токены человека хранит в памяти и прикрепляет к каждому запросу.

**Эндпоинты:** `${issuer}/protocol/openid-connect/{auth,token,logout}`. Authorize: `response_type=code`, `client_id`, `redirect_uri=${origin}/auth/openid/callback`, `scope=openid`, `code_challenge`, `code_challenge_method=S256`, `state`. Обмен и refresh — `POST /token` (`application/x-www-form-urlencoded`).

**PKCE** (`auth/pkce.ts`): `code_verifier` — 32 случайных байта hex, `state` — 16 байт hex, `code_challenge` — SHA-256 → base64url. Хранятся в `sessionStorage` (`admin.pkce.verifier`, `admin.pkce.state`), одноразовые.

**Хранение токенов** (`auth/tokenStore.ts`): только в памяти модуля. `Session = {token, refreshToken?, idToken?, expiresAt, user}`; `user` читается из claims access-токена (`sub`, `name || preferred_username`, `email`). После перезагрузки токенов нет — сессия восстанавливается тихо через живую SSO-сессию.

**Обновление:** `refreshSession()` — единый in-flight Promise, возвращает `ok | rejected | unavailable`. 400/401 от токен-эндпоинта → `rejected`; прочее → `unavailable`; после трёх `unavailable` подряд при истёкшем токене — `notifyUnauthorized()`.

**Тихая сессия** (`auth/silentSession.ts`): в `sessionStorage` флаг `admin.session.active` (в этой вкладке уже входили) и `admin.session.silentTarget` (путь возврата, TTL 10 мин, только относительный путь); в `localStorage` — `admin.session.loggedOut` (намеренный выход блокирует авто-редирект на SSO). При старте без сессии, но с ранее активной сессией, `AuthProvider` делает тихий `redirectToOpenId`.

**Поток входа:**

1. `RequireAuth`: при восстановлении — спиннер; без сессии — сохраняет цель и `Navigate → /login`.
2. `LoginPage`: без ошибки и без намеренного выхода один раз авто-редиректит на SSO; при недавней попытке (30 с) показывает кнопку вместо цикла.
3. `AuthCallbackPage` (`/auth/openid/callback`): сверяет `state`, вызывает `completeLogin(code)` (обмен → `setSession` → `markSessionActive`), затем `Navigate` на сохранённую цель или `/admin`. Ошибка → `/login?error=…`.
4. **Прикрепление токена** (`data-provider/http.ts`): request-интерсептор при остатке < 30 с до истечения вызывает `refreshSession()`, затем ставит `Authorization: Bearer`. Response-интерсептор на 401 повторяет один раз после refresh; `unavailable` → сетевая ошибка `ERR_NETWORK`; `rejected` → `notifyUnauthorized()` (сброс сессии, переход на `/login`).
5. **Выход** (`logout`): `markLoggedOutIntentionally`, сброс сессии, `queryClient.clear()`, переход на `buildLogoutUrl(origin + '/login', idToken)`.

Контекст: `AuthContext = {user, token, isAuthenticated, isRestoring, login, logout, completeLogin}`.

## 3. Доступ и маршрутизация

Панель открывается, если справочник вернул `is_admin`, либо сервер ассистента вернул полномочие `access:admin`. Хук `useAccess` объединяет два запроса: `GET {admin-api}/admin/v1/me` (`isAdmin`) и `GET {office}/api/office/admin/me/capabilities` (`aiCapabilities: Set`, `aiRole`, `aiDepartmentId`, `departmentName`); `canEnter = isAdmin || capabilities.has('access:admin')`.

Панель разделена на две вкладки (`AdminTabs`): «Общие» (видна только администратору) и «AI» (разделы фильтруются по полномочиям).

| Путь | Компонент | Защита |
|---|---|---|
| `/login`, `/auth/openid/callback` | `LoginPage`, `AuthCallbackPage` | нет |
| `/admin` | `AdminLayout` (в `RequireAuth`) | аутентификация |
| `/admin` index | `AdminHome` | админ → `/admin/users`, иначе `/admin/ai/users` |
| `/admin/users*` | `EmployeesView` / `EmployeeCreatePage` / `EmployeeEditPage` | `RequireAdmin` |
| `/admin/departments*` | `DepartmentsView` / Create / Edit | `RequireAdmin` |
| `/admin/ai/departments*` | `AiDepartmentsView` / `AiDepartmentEditPage` | `RequireAdmin` |
| `/admin/ai/users*` | `AiUsersView` / `AiUserEditPage` | capability `read:users` (сервер) |
| `/admin/requests` | `RequestsView` | `manage:limit_requests` |
| `/admin/prompts` | `PromptsView` | `manage:prompts` |
| `/admin/knowledge*` | `SpacesView` / Create / Edit / `SpaceDocumentsPage` | `manage:knowledge_documents` |
| `/admin/spend` | `SpendView` | `read:usage` |
| `/admin/analytics` | `AnalyticsView` | `read:insights` |
| `/admin/feedback` | `FeedbackView` | `manage:configs` |
| `/admin/memory` | `MemoryView` | `manage:roles` |

Маршруты AI-разделов не обёрнуты клиентской проверкой полномочий — они закрыты скрытием в навигации и ответами сервера (403). `RequireAdmin` же жёстко уводит не-администратора на `/admin/ai/users`.

Навигация (`adminNav.config.tsx`): вкладка «Общие» → «Сотрудники» (`Users`), «Отделы» (`Building2`); вкладка «AI» → «Настройки AI сотрудников» (`read:users`), «Настройки AI отделов» (`manage:configs`), «Заявки на лимит» (`manage:limit_requests`), «Промпты» (`manage:prompts`), «База знаний» (`manage:knowledge_documents`), «Расходы» (`read:usage`), «Аналитика» (`read:insights`), «Обратная связь» (`manage:configs`), «Память» (`manage:roles`). Тип `Capability` перечисляет все одиннадцать полномочий.

Роли: `OWNER | ADMIN | HEAD | USER`; `assignableRoles(actor)`: OWNER назначает все четыре, ADMIN — ADMIN/HEAD/USER.

## 4. Клиент API

Единого класса нет: `src/api/index.ts` — barrel-реэкспорт типов и объекта `request = {get, getResponse, post, postMultiPart, put, patch, delete}` поверх одного axios-инстанса. Конверты ответов (`{users,total}`, `{department}`, …) разворачиваются централизованно. `retrySkipping4xx`: 4xx без повтора, иначе до двух попыток. Две базы: office API (`${VITE_API_BASE_URL}/api/office/...`) и directory (`${VITE_ADMIN_API_URL}/admin/v1/...`, таймаут `/me` — 15 с).

Полный перечень вызываемых эндпоинтов — в [api-reference.md](api-reference.md).

**Кэширование и мутации:** `refetchOnWindowFocus:false`; `keepPreviousData` для списков; `staleTime` для транскрипта (5 мин), изображений (30 мин), баланса провайдера. Мутации показывают тосты (`com_admin_toast_*` / `getAdminErrorMessage`) и инвалидируют связанные ключи (`usersRoot`, `userRoot`, `departments`, `settings`, `limitRequests`, `employeesRoot`, `spaces`, `documents` и т. п.).

**Ошибки:** тело directory — `{error_code, message, fields?}`; `directoryErrorKey` сопоставляет код с ключом перевода `com_admin_directory_error_<код>`, `directoryFieldErrors` — причины полей (`required`, `too_long`, `invalid`, `unknown`, `no_department`). Для office — `getAdminErrorMessage` (по `error_code`, 403, тексту ответа). `formatUsd` — локаль `ru-RU`, 2 знака (4 знака для сумм < 0,01), префикс `$`.

## 5. Разделы админ-панели

Общие паттерны: `AdminPageHeader{title, description?, action?}`; состояния `LoadingState` / `AdminErrorState{message,onRetry}` / `EmptyState`; таблицы с кликабельными строками; формы в `PageColumns` (1–2 колонки); подтверждения через `AlertDialog`; тосты через `useToastContext`. Хуки: `useDebounce`, `useFreshFormKey`, `useLocalize`, `useRoleLabel`, `useModelLabel`, `useScenarioLabel`.

### 5.1. Сотрудники (`/admin/users*`, только админ, directory API)

Список `EmployeesTable` (50 на страницу, поиск с задержкой 350 мс): имя (ссылка), email, должность, отдел, статус (`Tag` + метки «Админ»/«Глава»), действия. Для не активировавшихся — «Отправить повторно» (`POST /invite` → `InviteLinkDialog`) и «Отозвать» (`DELETE ?only_invited=true`). Фильтры: поиск, отдел (`all`/`none`/id), статус (`all|active|invited|blocked`). Карты статуса: invited→info, invite_expired→warning, active→success, blocked→error.

`EmployeeCreatePage`: поля `first_name` (обязательно), `last_name`, `email` (обязательно), `position`, `department`; `POST /employees`; тост и `InviteLinkDialog` → переход на карточку.

`EmployeeEditPage`: карточка «Профиль» (email заблокирован у приглашённых) + карточка «Доступ» (статус, повторное приглашение со сменой email, чекбоксы «Администратор»/«Глава отдела», переключатель «Заблокирован», «Сбросить пароль» → `TemporaryPasswordDialog`, ссылка на AI-настройки). `buildChanges` шлёт в `PATCH` только изменённое; признаки доступа, блокировка, сброс и удаление недоступны для своей карточки (`isSelf`). Удаление — `DELETE` (или отзыв для приглашённых).

`InviteLinkDialog` и `TemporaryPasswordDialog` — модальные, с запретом закрытия вне кнопки, поле `readOnly`, кнопка копирования.

### 5.2. Отделы (`/admin/departments*`, только админ, directory API)

`DepartmentsView`: таблица «Название»/«Описание»/«Сотрудников»/действия; удаление отключено при непустом отделе. `DepartmentForm`: `name` (обязательно), `description`. Create → `POST /departments`; Edit → `PATCH` только изменённого, ссылка на AI-настройки отдела.

### 5.3. Настройки AI сотрудников (`/admin/ai/users*`, `read:users`, office API)

`AiUsersTable` (50 на страницу, offset-пагинация, поиск 350 мс): пользователь (ссылка, метка «Заблокирован»), должность, отдел, роль, лимит (`spendToday` из `dailyCostUsd`), модель по умолчанию. Фильтры: поиск, отдел, роль.

`AiUserEditPage`: панель профиля (имя, должность, отдел, ссылка на общий профиль для админа). Карточка «Роль и модели» (роль только для чтения, личный список моделей через `ModelAccessFields`). Карточка «Лимиты и знания»: личный лимит (`LimitsFields`, при `manage:users`), `canUploadKnowledge` и два `SpacesMultiSelect` (`allowedSpaces` — дополнительные, `deniedSpaces` — запрещённые; при `manage:department_members`). Наследование значений от отдела и глобальных настроек реализовано зеркально серверу (`inheritance.ts`, `override.ts`): выключенный переключатель показывает унаследованное значение, включённый — личный черновик. `buildUpdateUserPayload` шлёт только затронутые блоки (`null` = снять переопределение). Валидация: при непустом списке моделей обязательна модель по умолчанию. Состояния: 404 → «запись ещё синхронизируется», 403 → «нет прав».

### 5.4. Настройки AI отделов (`/admin/ai/departments*`, `manage:configs` + только админ)

`AiDepartmentsView`: таблица отделов (ссылка по `directoryId`), модель по умолчанию, лимиты. `AiDepartmentEditPage` (`:id` = directoryId): системный промпт отдела (`Textarea`, 12 строк), `ModelAccessFields`, `LimitsFields` (с «наследует»); `PATCH /departments/{aiId}`. Название/описание отдела приходят из справочника.

### 5.5. Заявки на лимит (`/admin/requests`, `manage:limit_requests`)

`RequestsView`: фильтр статуса (`pending` по умолчанию). Колонки: пользователь, окно (`daily`), изменение лимита (`до → после` + история), дата, комментарий, статус, действия. Для `pending`: «Отклонить» (`POST reject`) и «Одобрить» (`ApproveRequestDialog` — поле нового лимита, история; `POST approve` с `{limits}`). `buildApproveLimitsPayload`: пустая строка → `{}`, иначе `{dailyCostUsd: Number}`.

### 5.6. Промпты и общие настройки (`/admin/prompts`, `manage:prompts`)

Один экран (`GET`/`PUT /settings`): глобальный системный промпт (`Textarea`), `ModelAccessFields`, `ModelCapabilitiesFields` (по каждой разрешённой модели — `knowledgeBase`/`webSearch` и переопределение `label`/`description`), `LimitsFields`. `modelCapabilities` отправляется массивом `[{modelId, …}]` (ключи с точками не проходят защиту сервера). Ниже — обзор промптов отделов.

### 5.7. База знаний (`/admin/knowledge*`, `manage:knowledge_documents`)

`SpacesView`: таблица разделов (название, отделы, число документов, статус, действия). Кнопка создания и правка/удаление скрываются для руководителя вне его отдела (`headCanManageSpace`). `SpaceForm`: `name`, `description`, отделы (`DepartmentsMultiSelect`; для руководителя — статичное имя его отдела), переключатель `enabled`.

`SpaceDocumentsPage`: действия «Назад», «Переиндексировать» (`manage:configs`, `POST /reindex`, показывает пропущенные), «Загрузить». Фильтр статуса. Основная таблица — неархивные документы, отдельная секция — архив. `DocumentUploadForm`: файл (`accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv"`), `title` (обязателен), `source`, `owner`, `version`, `effectiveDate`, `status`; режим замены добавляет `supersedesId`. `DocumentRow`: Tag статуса, метка «не проиндексирован» при `!embedded`, действия «заменить»/«архивировать»/«удалить».

### 5.8. Расходы (`/admin/spend`, `read:usage`)

`SpendView` (25 на страницу): фильтры — диапазон (быстрые `24h/7d/30d` + пикер, до 180 дней), отдел (при `manage:configs`), пользователь (комбобокс с серверным поиском), модель (из `/api/models`). Колонки: раскрытие, дата, пользователь, отдел, модель, сценарий, вызовы, токены, стоимость (`Tag warning` при неизвестной стоимости). В шапке — `ProviderBalance` (`GET /provider-balance`, при `manage:configs`). `RequestRow` раскрывает `Transcript` (переписка через `GET …/transcript`, Markdown, сгенерированные картинки через blob) и `CallBreakdown` (вызовы модели: дата, модель, сценарий, токены, стоимость с пометкой источника `provider`/`estimate`/`unknown`).

### 5.9. Аналитика (`/admin/analytics`, `read:insights`)

Панель: диапазон + группировка (`user|department|model|day|scenario`, по умолчанию `department`). `GET /analytics/activity` (метрики: активные пользователи, запросы, среднее, вернувшиеся, отзывы) и `GET /analytics` (строки). Блоки: общая стоимость (+`Sparkline` для группировки по дням), список с `Progress`-долями, таблица «Группа / Стоимость / Запросы / Токены». Вызовы с неизвестной стоимостью считаются отдельно.

### 5.10. Обратная связь (`/admin/feedback`, `manage:configs`)

`GET /feedback` (25 на страницу). Фильтры: диапазон и рейтинг (`all|thumbsUp|thumbsDown`). Колонки: дата, пользователь, модель, рейтинг (иконка), причина (`FEEDBACK_REASON_KEYS`), текст.

### 5.11. Память (`/admin/memory`, `manage:roles`)

Выбор роли (`USER, HEAD, ADMIN, OWNER`), чекбоксы прав `USE, CREATE, READ, UPDATE, OPT_OUT` (все, кроме `USE`, отключены при снятом `USE`). `GET /api/roles/:role`, `PUT /api/roles/:role/memories` — права памяти через механизм ролей LibreChat.

### 5.12. Общие компоненты (`common/`)

`LimitsFields` (поле `dailyCostUsd`, `parseLimitInput`: пусто → `null`), `ModelAccessFields` (`ModelsMultiSelect` + модель по умолчанию, `reconcileDefaultModel`), `ModelsMultiSelect` (каталог `/models`, цены, модальности), `ModelDetailsDialog`, `ModelCapabilitiesFields`, `DepartmentsMultiSelect`, `SpacesMultiSelect`, `PageColumns`/`PageCard`, `insightsKit` (диапазоны, форматтеры, `MetricCard`, `Sparkline`), `useFreshFormKey`. Утилиты: `roleLabels`, `scenarioLabels`, `modelLabels`, `modelMeta`, `format`, `directoryErrors`.

## 6. Интернационализация и тема

**Язык:** `supportedLocales = ['ru','en']`, словари `src/locales/{ru,en}/translation.json` (плоские ключ→строка, ключи `com_admin_*`, `com_ui_*`, `com_insights_*`), интерполяция `{{name}}`. По умолчанию `ru` (независимо от браузера), хранится в `localStorage.lang`. `useLocalize` ищет в текущем языке → `en` → сам ключ. `LanguageToggle` — `SegmentedControl` RU/EN. Денежный формат всегда `ru-RU`.

**Тема:** `light | dark | system` (по умолчанию `system`), `localStorage.theme`. `ThemeProvider` слушает `prefers-color-scheme` в режиме `system`, переключает класс `dark` на `<html>`. `ThemeToggle` — три иконки (`Sun`/`Moon`/`Monitor`). Мигание темы снимается скриптом в `index.html`. Цветовые токены — CSS-переменные в `src/index.css`.
