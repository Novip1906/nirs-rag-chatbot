# Спецификация: модель данных

Полная модель данных системы по трём хранилищам: MongoDB (сервер ассистента), PostgreSQL сервиса сотрудников (`admin-api`) и PostgreSQL с pgvector (векторный индекс). Обзор хранилищ — в [architecture.md](../architecture.md); эта спецификация спускается до полей и индексов.

## 1. MongoDB (сервер ассистента)

Схемы Mongoose: `ai/packages/data-schemas/src/schema/*.ts`. К штатным коллекциям LibreChat (беседы, сообщения, файлы, оценки, пользователи) добавлены корпоративные. Общая вложенная схема лимитов `limitsFields = { dailyCostUsd: Number, default null }` (`_id: false`), по умолчанию `{ dailyCostUsd: null }`.

### 1.1. Расширения `User`

Добавленные поля: `role` (String, default `USER`), `openidId`, `openidIssuer`, `employeeId`, `position` (default `''`), `tenantId`. Индексы: `{email, tenantId}` unique, `{role, tenantId}`, `{employeeId}` unique partial `{employeeId:{$exists:true}}`, `{openidId, openidIssuer, tenantId}` unique partial `{openidId:{$exists:true}}`.

### 1.2. `userPolicy` — политика сотрудника

| Поле | Тип | По умолчанию |
|---|---|---|
| `userId` | ObjectId → User | required, unique, index |
| `departmentId` | ObjectId → Department | null, index |
| `limits` | `limitsFields` | null (null = без ограничения) |
| `allowedModels` | [String] | null |
| `defaultModel` | String | null |
| `blocked` | Boolean | false |
| `allowedSpaces` | [ObjectId → KnowledgeSpace] | `[]` |
| `deniedSpaces` | [ObjectId → KnowledgeSpace] | `[]` |
| `canUploadKnowledge` | Boolean | false |

### 1.3. `department` — отдел (зеркало справочника)

`name` (required, unique, trim), `description`, `systemPrompt` (`''`), `allowedModels` (`[]`), `defaultModel` (null), `defaultLimits` (`limitsFields`), `directoryId` (идентификатор в `admin-api`). Индекс `{directoryId}` unique partial `{directoryId:{$type:'string'}}`. `timestamps`.

### 1.4. `corporateSettings` — глобальные настройки

Одна запись `key = 'global'` (enum, unique). Поля: `systemPrompt` (`''`), `allowedModels` (`[]`), `defaultModel` (null), `defaultLimits`, `modelCapabilities` (Mixed, `{}`). `modelCapabilities` — карта `providerModelId → {knowledgeBase?, webSearch?, label?, description?}`; `label`/`description` переопределяют подписи модели в выборе.

### 1.5. `knowledgeSpace` — раздел базы знаний

`name` (required, unique, trim), `description` (`''`), `allowedDepartments` ([ObjectId → Department], `[]` = доступен всем отделам), `embeddingModel` (`'baai/bge-m3'`), `enabled` (true). `timestamps`.

### 1.6. `knowledgeDocument` — документ базы знаний

| Поле | Тип | По умолчанию |
|---|---|---|
| `spaceId` | ObjectId → KnowledgeSpace | required, index |
| `file_id` | String | required, unique, index |
| `title` | String | required, trim |
| `description`, `filename`, `source`, `owner`, `version` | String | `''` |
| `effectiveDate` | Date | null |
| `status` | String enum `active\|archived\|draft` | `active`, index |
| `supersedesId` | ObjectId → KnowledgeDocument | null |
| `embeddingModel`, `storagePath`, `text`, `mimetype` | String | `''` |
| `bytes` | Number | 0 |
| `embedded` | Boolean | false |
| `uploadedBy` | ObjectId → User | required |

Индексы: `{spaceId, status}`; текстовый `{title:'text', text:'text'}` (`default_language:'russian'`, веса `title:3, text:1`, имя `knowledge_text_ru`) — основа лексического поиска.

### 1.7. `usageRecord` — журнал расходов

| Поле | Тип | По умолчанию |
|---|---|---|
| `userId` | ObjectId → User | required |
| `departmentId` | ObjectId → Department | null |
| `model` | String | required |
| `conversationId`, `messageId` | String | — |
| `promptTokens`, `completionTokens`, `costUsd` | Number | 0 |
| `costSource` | String enum `provider\|estimate\|unknown` | `unknown` |
| `scenario` | String | `''` |
| `imagePrompt`, `imageFileId` | String | — |

`timestamps` только `createdAt`. Индексы: `{userId, createdAt:-1}`, `{departmentId, createdAt:-1}`, `{model, createdAt:-1}`, `{createdAt:-1}`. Значения `scenario`: обычное сообщение (`''`), `image_gen`, `stt`, `kb_index`, `doc_index`, `chat_recap`, `memory_compact`.

### 1.8. `limitRequest` — заявка на лимит

`userId` (required), `window` (enum `['daily']`, required), `comment`, `limitBefore`/`limitAfter` (null), `status` (enum `pending|approved|rejected`), `resolvedBy`, `resolvedAt`. Индексы: `{status, createdAt:-1}`; `{userId, window}` unique partial `{status:'pending'}` (одна открытая заявка на сотрудника).

### 1.9. `chatProject` / `projectDocument` — проекты сотрудника

`chatProject`: `name` (required, ≤100), `description` (≤1000), `user` (required), `conversationCount`, `lastConversationAt`, `lastConversationId`, `tenantId`.

`projectDocument`: `owner`, `projectId` (→ ChatProject), `entityId`, `file_id` (unique), `title`, `filename`/`mimetype`/`storagePath`/`text`, `bytes`/`tokenCount`, `embedded`, `status` (enum `active|deleted`). Индекс `{owner, projectId, status}` и собственный текстовый индекс `project_document_text_ru` (отдельная коллекция, так как MongoDB допускает один текстовый индекс на коллекцию).

### 1.10. `memory` / `memorySnapshot` — память

`memory` (MemoryEntry): `userId`, `key` (шаблон `/^[a-z_]+$/`), `value`, `title`, `agentId` (партиция агента), `chatProjectId` (партиция проекта), `tokenCount`, `updated_at`. Индексы `{userId, agentId, key}`, `{userId, chatProjectId, key}`. Личная память — без `agentId`/`chatProjectId`.

`memorySnapshot`: снимок раздела до сжатия. `entries[]`, `reason` (enum `manual|auto`), `before`/`after` (токены), `appliedAt`, `compactedIds`. TTL-индекс `{createdAt}` — 30 дней (`MEMORY_SNAPSHOT_TTL_SECONDS = 2592000`).

### 1.11. `systemGrant` / роли — полномочия

`systemGrant`: `principalType` (enum `user|group|public|role`), `principalId`, `capability` (валидатор), `tenantId`, `grantedBy`, `grantedAt`, `expiresAt` (зарезервировано). Индекс `{principalType, principalId, capability, tenantId}` unique. Записи — только через `grantCapability`. Роли `OWNER`/`ADMIN`/`HEAD`/`USER` получают свои полномочия при старте (см. [ai-server.md](ai-server.md)).

### 1.12. `auditLog` — аудит (append-only)

Все поля `immutable`; pre-хуки блокируют любые update/delete/replace. Поля: `schemaVersion`, `category` (enum, в т.ч. `dlp`, `grant`, `auth`, `config`, `permission`, `approval`, `tool_call`), `action` (напр. `dlp.masked`, `dlp.failed`, `grant.assigned`), `outcome` (`success|failure|denied|pending`), `severity` (`info|warning|critical`), `actor {type,id,name}`, `target {type,id,name}`, `metadata`, `context {requestId,ip,userAgent,sessionId}`, цепочка целостности `chainKey`/`seq`/`prevHash`/`hash`. Индекс `{chainKey, seq}` unique.

## 2. PostgreSQL сервиса сотрудников (`admin-api`)

Миграции — goose (`admin-api/internal/store/migrations`). Время записей — `clock_timestamp()`. Мягкое удаление: строка остаётся, ставится `deleted_at` (= `updated_at`).

### 2.1. `departments`

| Столбец | Тип и ограничения |
|---|---|
| `id` | `uuid PRIMARY KEY` |
| `name` | `text NOT NULL` |
| `description` | `text NOT NULL DEFAULT ''` |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `deleted_at` | `timestamptz` (NULL) |

Индексы: `UNIQUE (lower(name)) WHERE deleted_at IS NULL`; `(updated_at)`.

### 2.2. `employees`

| Столбец | Тип и ограничения |
|---|---|
| `id` | `uuid PRIMARY KEY` |
| `keycloak_sub` | `text NOT NULL` |
| `email` | `text NOT NULL` |
| `first_name`, `last_name` | `text NOT NULL` |
| `position` | `text NOT NULL DEFAULT ''` |
| `department_id` | `uuid REFERENCES departments(id)` (NULL) |
| `is_admin`, `is_head`, `blocked` | `boolean NOT NULL DEFAULT false` |
| `invited_at`, `invite_expires_at`, `activated_at`, `name_confirmed_at` | `timestamptz` (NULL) |
| `invited_by` | `uuid REFERENCES employees(id)` (NULL) |
| `avatar_version` | `text` (NULL) |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `deleted_at` | `timestamptz` (NULL) |

Индексы: `UNIQUE (keycloak_sub)` (с учётом удалённых); `UNIQUE (email) WHERE deleted_at IS NULL`; `(updated_at)`; `(department_id) WHERE deleted_at IS NULL`; `(id) WHERE activated_at IS NULL AND deleted_at IS NULL`.

### 2.3. `employee_avatars`

`employee_id uuid PRIMARY KEY REFERENCES employees(id)`, `content bytea NOT NULL` (JPEG ≤512×512), `updated_at timestamptz NOT NULL DEFAULT now()`.

### 2.4. `audit_log`

`id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, `at timestamptz NOT NULL DEFAULT clock_timestamp()`, `actor_id uuid REFERENCES employees(id)` (NULL), `action text NOT NULL`, `target_type text NOT NULL`, `target_id uuid NOT NULL`, `details jsonb NOT NULL DEFAULT '{}'`. Индекс `(target_type, target_id, id DESC)`.

## 3. PostgreSQL с pgvector (векторный индекс)

База `ragdb`. Схему создаёт и ведёт `rag-api`: фрагменты документов с эмбеддингами (модель `baai/bge-m3`) и метаданными (`file_id`, страница), привязанные к сущности `entity_id` — идентификатору раздела базы знаний или проекта сотрудника. Сервер ассистента обращается к индексу только через `rag-api` (`/embed`, `/query_multiple`, `/documents`).

## 4. Соответствие справочника и зеркала

`admin-api` — источник истины по сотрудникам и отделам; сервер ассистента держит зеркало (`User`, `Department`, `UserPolicy`) и синхронизирует его (уведомления + полная сверка). Сопоставление сотрудника — по `employeeId`/`directoryId`, а не по `sub` (при повторном приглашении `sub` меняется). Подробности синхронизации — в [ai-server.md](ai-server.md), §9.
