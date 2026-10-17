# Спецификация: сервер ассистента (корпоративные доработки)

Сервер ассистента — форк LibreChat (MIT) с корпоративными доработками. Отвечает за чат и вызовы моделей, RAG, DLP, лимиты и журнал расходов, память, проекты, инструменты (поиск по базе знаний, веб-поиск, картинки, экспорт файлов, диктовка), office API для админ-панели и синхронизацию справочника. Реализация — каталог `ai/`; доработки сосредоточены в `ai/packages/api/src/corporate` (далее PC), `ai/packages/api/src/admin/corporate` (PA), `ai/packages/api/src/dlp` (PD), `ai/packages/api/src/directory` (PDIR), `ai/api/server/routes/office.js`, `ai/api/server/routes/directory.js`, `ai/packages/data-schemas`.

Смежные документы: [data-model.md](data-model.md), [api-reference.md](api-reference.md), [deployment.md](deployment.md).

## 1. Технологии

Node.js 24, Express 5, Mongoose 8, TypeScript; монорепозиторий пакетов (`api`, `packages/api`, `packages/data-schemas`, `packages/data-provider`). Клиент чата — React 18 (часть того же образа). Процесс слушает порт 3080; API и статика клиента отдаются одним процессом. Провайдер моделей — внешний OpenAI-совместимый API.

## 2. Конфигурация

Читается один раз при старте; смена требует перезапуска пода. Два источника: переменные окружения (`ConfigMap librechat-env`) и файл `librechat.yaml` (`ConfigMap librechat-yaml`, монтируется в `/app/librechat.yaml`).

### 2.1. `librechat.yaml`

`version: 1.3.14`, `cache: true`.

**Интерфейс.** Включены `modelSelect`, `memories`, `webSearch`, `fileCitations`, `feedback`, `speechToText`. Выключены `parameters`, `presets`, `bookmarks`, `prompts`, `multiConvo`, `skills`, `sharedLinks`, `temporaryChat`, `runCode`, `fileSearch`, `textToSpeech`, `messageEdit`, `fork`. Отключены `agents`, `marketplace`, `mcpServers`, `schedules`, `peoplePicker`. `defaultPinnedTools: [knowledge_search, web_search]`.

**modelSpecs** (`enforce: true`, `prioritize: true`): сотрудник выбирает только из списка.

| name | label | по умолчанию | модель провайдера |
|---|---|---|---|
| `gpt-5-6-luna` | GPT-5.6 Luna | да | `openai/gpt-5.6-luna` |
| `gemini-3-7-flash` | Gemini 3.7 Flash | — | `google/gemini-3.7-flash` |
| `claude-sonnet-5` | Claude Sonnet 5 | — | `anthropic/claude-sonnet-5` |

У всех трёх флаги `knowledgeBase`, `webSearch`, `memory`, `fileExport`, `imageGeneration` = true. `preset.endpoint = '${AI_ACTIVE_ENDPOINT}'` — метка, заменяемая именем эндпоинта активного провайдера при загрузке.

**dlp**: `enabled: true`, `maskEmbeddings: true`; шесть категорий в режиме `mask`.
**memory**: `disabled: false`, `personalize: true`, `charLimit: 2000`, `tokenLimit: 12000`; сжатие моделью `titleModel`.
**imageGeneration**: `model: openai/gpt-5.4-image-2`, `resolution: 1K`, `quality: medium`, `outputFormat: jpeg`, `estimatedCostUsd: 0.05`.
**webSearch**: `searchProvider: tavily`, `scraperProvider: tavily`, `rerankerType: none`.
**speech.stt.openrouter**: `model: google/gemini-3.7-flash`.
**fileConfig**: `serverFileSizeLimit: 50`; вложения `fileLimit: 10`, `fileSizeLimit: 50`; разрешённые MIME — изображения, pdf, docx/xlsx/pptx, xls, odt/ods, doc/rtf, `text/*`, json/xml/csv/yaml и др.
**endpoints.agents**: `toolApproval: {enabled: true, mode: 'bypass', ask: ['generate_image']}`.
**endpoints.custom**: два эндпоинта одинаковой структуры — `Corporate AI` (`${AI_BASE_URL}`, валюта RUB, `usage.cost_rub`) и `OpenRouter` (`${OPENROUTER_BASE_URL}`, валюта USD, `usage.cost`). Общие: модели по умолчанию (три именованные), `fetch: true`, `titleConvo: true`, `titleModel: openai/gpt-5.6-luna`, `addParams: {parallel_tool_calls: false}`, русский `titlePrompt` (язык запроса, ≤5 слов). Оба эндпоинта должны оставаться объявленными, так как имя эндпоинта записывается в беседах.

### 2.2. Переменные окружения

Сгруппированы в [architecture.md](../architecture.md), §5.6. Ключевые: провайдер (`AI_PROVIDER`, `AI_BASE_URL`, `OPENROUTER_BASE_URL`, `RUB_PER_USD`), вход (`OPENID_*`, `ADMIN_OIDC_AUDIENCE=corporate-ai`, `ADMIN_OIDC_CLIENT=admin`), справочник (`ADMIN_API_URL`, `ADMIN_API_CLIENT_ID=ai-admin-api`, `ADMIN_API_NOTIFY_CLIENT=admin-api-notify`, `ADMIN_API_NOTIFY_AUDIENCE=corporate-ai`, `ADMIN_API_SYNC_MODE`, `ADMIN_API_SYNC_INTERVAL_MS=60000`, `ADMIN_API_SYNC_MAX_CHANGES=5`), хранилище базы знаний (`KNOWLEDGE_S3_*`), RAG (`RAG_API_URL`), `MONGO_URI`, `TZ=Europe/Moscow`.

## 3. Аутентификация и цепочки middleware

**Office admin** (`/api/office/admin`): `requireAdminToken` → `requireAdminAccess` (`access:admin`) → полномочие раздела и сужение по отделу в обработчике.

`requireAdminToken`: Bearer обязателен (иначе 401); верификатор не настроен или недоступен → 503; требуются `claims.sub`, `claims.azp === (ADMIN_OIDC_CLIENT||'admin')`, `aud` содержит `(ADMIN_OIDC_AUDIENCE||'corporate-ai')`; пользователь ищется `findUser({openidId: sub})`; при его отсутствии и `ADMIN_API_SYNC_MODE==='apply'` он провиженится «на лету» из справочника (пока директория недоступна → 503; параллельные провижены одного `sub` объединяются). Затем `tenantContextMiddleware` и `requireUnblocked`. `requireAdminAccess` намеренно не сверяется с `ADMIN_LEVEL_ROLES`, чтобы руководитель (`HEAD`) тоже проходил.

**Office usage и knowledge (сотрудник)**: `requireJwtAuth` (включает `requireUnblocked`).

**Чат**: `requireUnblocked` (блокировка) и `checkOfficeLimits` (суточный лимит и допустимость модели) подключены к роутеру чата.

`requireUnblocked`: пропускает `GET /api/user` и `/api/auth/*`; заблокированному отвечает `corporate_blocked` (для чата — через `denyRequest`, иначе 403 с русским сообщением).

`checkOfficeLimits`: нет userId → `corporate_check_failed`; `assertWithinLimits`; при превышении — `corporate_limit` (`window, kind, used, limit, resetAt, message`) с русским сообщением и временем сброса в `process.env.TZ || 'Europe/Moscow'`; модель запроса должна входить в `policy.allowedModels` (если список непуст), иначе `corporate_model_not_allowed`.

## 4. Политика (`PC/policy.ts`)

`resolvePolicy(deps, userId)` объединяет глобальные настройки, отдел и политику сотрудника:

| Поле | Правило |
|---|---|
| `limits` | `resolveLimits(global, department, user)`: если личная политика есть, лимиты берутся **только** из неё (`null` = без ограничения, а не «взять из отдела»); иначе наследуется отдел, затем глобальный |
| `allowedModels` | первый непустой список по порядку user → department → global; пустой везде = «без ограничений», не «запрет» |
| `defaultModel` | `resolveDefaultModel`: первый из `[user, department, global]`, входящий в `allowedModels`; иначе `allowedModels[0]`; при пустом списке — первый непустой кандидат или `null` |
| `systemPrompt` | `[global.systemPrompt, department.systemPrompt].filter(Boolean).join('\n\n')` — промпт отдела добавляется после глобального |
| `blocked` | `userPolicy.blocked ?? false` |
| `modelCapabilities` | только глобальные |

Единственный лимит — `dailyCostUsd` (`LIMIT_KEYS = ['dailyCostUsd']`); лимитов по числу запросов и месячных нет. `mergeLimits` собирается по ключам (spread Mongoose-документа ломается): `null` в override не перекрывает базу.

**`modelFilter.ts`**: фильтрует `modelsConfig` и `modelSpecs` под сотрудника; для разрешённых моделей без спека создаёт синтетические спеки (иконка из `VENDOR_ICON_MAP`, флаги `knowledgeBase`/`webSearch` из `modelCapabilities`, подписи-переопределения). При ошибке политики — fail-open (не фильтрует).

**`provider.ts`**: активный провайдер из `AI_PROVIDER` (`openrouter` по умолчанию). `openrouter` — валюта USD, `usage.cost`, баланс `/credits` (`total_credits - total_usage`); `polza` — валюта RUB, `usage.cost_rub`, баланс `/balance` (`amount`). `convertToUsd` делит рубли на `RUB_PER_USD` (по умолчанию `85.6`).

## 5. Доступ, лимиты, учёт расходов

**`access.ts`**: `isUserBlocked` с кэшем (TTL 30 с, до 5000 записей), `invalidateBlockedUser` сбрасывает запись; ошибка чтения → `false` (fail-open).

**`limits.ts`**: граница суток — локальное время процесса (`TZ`). `assertWithinLimits`: `policy.blocked` блокирует без окна; иначе `getUsageTotals(userId, startOfDay)`; `checkThreshold`: блокировка при `used >= limit`; лимит `null`/`NaN`/`Infinity` не блокирует; вердикт `{allowed, window:'daily', kind:'cost', used, limit, resetAt}`.

**`record.ts`**: `buildUsageInput` берёт стоимость из `providerUsage.cost_usd` (конечное число ≥ 0 → `costSource='provider'`; иначе `costSource='unknown'`, `costUsd=0`). Поля `UsageRecord` — см. [data-model.md](data-model.md). `recordUsage` не пробрасывает ошибку (только логирует).

**Сценарии**: `message` (пустой = `message`), `title`, `kb_index`, `kb_query`, `doc_index`, `stt`, `image_gen`, `chat_recap`, `memory_compact`, `subagent`. `SYSTEM_SCENARIOS = ['title','kb_index','kb_query','chat_recap','memory_compact']` не входят в суточный лимит сотрудника, но попадают в аналитику. `getUsageTotals`: `$match` по `userId`, `createdAt >= since`, `scenario $nin SYSTEM_SCENARIOS`; `costUsd` суммируется только для `costSource != 'unknown'`.

`GET /api/office/usage/me` отдаёт суточный и месячный расход, суточный лимит и открытые заявки. `POST /api/office/usage/request-limit` принимает только `window==='daily'`.

## 6. База знаний и RAG

### 6.1. Доступ (`PC/knowledge/access.ts`)

`resolveAllowedSpaces` (чтение/поиск): для заблокированного — `[]`; раздел остаётся, если `enabled` и не в `deniedSpaces`, и далее выполнено одно из: роль admin-level; `allowedDepartments` пуст (виден всем); отдел сотрудника входит в `allowedDepartments`; раздел в `allowedSpaces` (явная выдача).

`resolveWritableSpaces` (запись сотрудником): для заблокированного — `[]`; из `enabled` разделов без `deniedSpaces`; admin-level — все; иначе нужна роль `HEAD` или `canUploadKnowledge` и отдел; остаются только разделы, где `allowedDepartments.includes(departmentId)` (пустой `allowedDepartments` права записи **не** даёт). В админском роутере глава может создавать/менять разделы только с `allowedDepartments === [свой отдел]`.

### 6.2. Гибридный поиск (`search.ts`, `fusion.ts`, `rag.ts`)

Константы: `DENSE_K_PER_SPACE=5`, `LEXICAL_LIMIT=20`, `MAX_HITS=10`, `RELEVANCE_FLOOR=0.45`, `RELEVANCE_RATIO=0.9`, `MIN_CHUNK_LENGTH=300`, `MAX_CHUNKS_PER_DOCUMENT=3`, `RRF_K=60`. Профили: база знаний — пороги `0.45`/`0.9`/`300`; документы проекта — `0`/`0`/`100`.

Алгоритм:

1. `resolveAllowedSpaces` → активные документы (`status='active'`) разрешённых разделов.
2. Параллельно — **плотный поиск** (на раздел `POST {rag}/query_multiple` c `{query, file_ids, k:5, entity_id: spaceId}`, ответ — фрагменты с `distance`) и **лексический** (`$text` по индексу `knowledge_text_ru`, веса `title:3, text:1`, русская морфология, `limit:20`).
3. **RRF** (`k=60`): `score(id) = Σ 1/(k + rank + 1)` по каждому списку; сортировка по score убыв.
4. Документ, найденный только лексикой, доозвучивается `POST {rag}/query` (`k:5`).
5. По каждому документу: фрагменты `length >= minChunkLength`, сортировка по `distance`, `slice(0,3)`.
6. `relevance = 1 - distance`; `cutoff = max(0.45, best*0.9)`; оставляются `relevance >= cutoff`; `slice(0,10)`.

`rag.ts`: URL из `KNOWLEDGE_RAG_API_URL||RAG_API_URL`; авторизация `Bearer generateShortLivedToken(userId)`; ошибки запросов → `[]`.

### 6.3. Приём документа (`ingest.ts`, `text.ts`, `mime.ts`, `objectStorage.ts`)

Порядок `ingestDocument`:

1. Раздел не найден → 404.
2. `fileId = randomUUID()`.
3. Сохранение оригинала: S3 (`s3://<bucket>/<spaceId>/<fileId>.<ext>`), если настроены все четыре `KNOWLEDGE_S3_*`, иначе на диск.
4. Извлечение текста: `POST {rag}/text`. Сбой → удаление оригинала, 502.
5. Проверка: длина > 15 000 000 → 400; `extractedTextProblem`: доля нечитаемых символов > 5% (`unreadable`) или длина < 200 (для `txt/md/csv` < 20) символов (`too_short`) → удаление оригинала, 400 с русской причиной.
6. Индексация: `POST {rag}/embed` c `entity_id=spaceId` и `normalizeForIndexing(text)`. Сбой → удаление оригинала, 502.
7. Создание `KnowledgeDocument` (метаданные, полный текст, `storagePath`, `embedded`). При `supersedesId` предыдущий документ архивируется.
8. `recordUsage` со сценарием `kb_index`.

Форматы (проверка расширения и MIME): `pdf, docx, xlsx, pptx, txt, md, csv`; лимит файла 25 МБ. Хранилище — MinIO (бакет `knowledge`) либо диск.

### 6.4. Инструменты базы знаний

**`knowledge_search`** (`citations.ts`): карточка фрагмента — `Документ / Якорь / Релевантность / Содержание`, якорь `turn0file<N>` (`N` — порядковый номер документа в ответе, неизменен). Артефакт `file_search` с полным списком источников (`fileId, fileName, content, relevance, pages, docTitle, spaceName, version, effectiveDate, owner`). Версия/дата/раздел — только в источниках, не в тексте для модели. Правила цитирования: якорь сразу после факта и знака препинания, хотя бы один на каждый использованный документ. В режиме обязательного поиска — если ничего не найдено, сказать, что в документах компании информации нет.

**`knowledge_list`** (`list.ts`, `LIST_DOCUMENT_CAP=200`): при ≤200 документах — список `{title, description, spaceName, version, effectiveDate}`; иначе — список разделов с количеством.

**Удаление** (`delete.ts`): `DELETE {rag}/documents?entity_id=<spaceId>` (вектора), затем запись из Mongo и оригинал; сбой удаления векторов → 502 (запись и оригинал остаются). **Переиндексация** (`reindexSpace`, admin-level): по каждому документу снимает и заново строит индекс; пропущенные (нет оригинала, сбой этапа) возвращаются списком.

## 7. DLP (`PD/`)

Включается только для OpenAI-совместимого custom endpoint при заданном `dlp` и наличии приёмника аудита. Категории: `secrets, payment_card, bank_account, ru_inn, ru_snils, ru_passport`; режимы `mask | shadow | off` (в поставке все шесть `mask`).

**Детекторы** (`detectors.ts`, RE2JS): `secrets` (PEM-ключи, `sk_live`/`pk_test`, `sk-…`, `AKIA…`, Bearer-токены, строки подключения к БД, `api_key=…` с энтропией Шеннона ≥ 4), `payment_card` (13–19 цифр с проверкой Луна), `bank_account` (IBAN с mod-97, 20-значный счёт), `ru_snils` (с контрольной суммой), `ru_inn` (10/12 цифр с контрольными разрядами), `ru_passport`. Текст нормализуется (`NFKC`, схлопывание пробелов) с обратным маппингом позиций; пересечения разрешаются жадно по приоритету категории.

**Маскирование** (`mask.ts`, `markers.ts`): значение заменяется на `[<LABEL>_<n>]` (`SECRET, CARD, ACCOUNT, INN, SNILS, PASSPORT`); одно значение в категории → одна заглушка. Похожий на заглушку пользовательский текст экранируется. **Восстановление** (`unmask.ts`): заглушки возвращаются в исходные значения, в потоке — через `MarkerStreamDecoder` (буферизует незакрытый хвост ≤ 32 символов).

**Обёртка fetch** (`fetch.ts`): маскирует поля `instructions/input/system` и `messages[].content`/`tool_calls.arguments`; добавляет системную инструкцию переносить заглушки в ответ дословно; после ответа пишет аудит и восстанавливает заглушки (включая `text/event-stream`). **Fail-closed**: любое исключение → `recordFailure` и `DlpFailureError` («DLP module failed; request was not sent») — запрос не уходит.

**Аудит** (`audit.ts`): `hashValue = sha256(value).slice(0,12)` (сами значения не пишутся). `recordFindings` на категорию: `action:'dlp.masked'`, `severity: secrets ? 'critical' : 'warning'`, `metadata:{dlpCategory, matchCount, valueHashes, mode}`. `recordFailure`: `action:'dlp.failed'`, `severity:'critical'`.

## 8. Прочие инструменты

**Картинки** (`PC/image/`): `generate_image(prompt ≤4000, aspect_ratio, image_ids ≤4)`; форматы `1:1`(по умолчанию)`,16:9,9:16,4:3,3:4,3:2,2:3`; `POST {baseURL}/images` (модель/разрешение/качество из конфига), таймаут 180 с; перед генерацией — подтверждение (`toolApproval.ask`) и проверка блокировки и остатка суточного лимита с учётом `estimatedCostUsd`; расход — сценарий `image_gen` (при отсутствии стоимости — `costSource='estimate'`). Входные картинки — до 20 МБ каждая.

**Экспорт** (`PC/export/`): `export_file(format, filename, …)`; форматы `docx, pdf, xlsx, csv, pptx, md`; таблицы до 100 000 строк; имя файла до 120 символов (санация запрещённых символов). `responseFormat: content_and_artifact`.

**Веб-поиск**: `web_search` через Tavily (поиск и чтение страниц), переранжирование выключено; закреплён в меню, включается флагом `webSearch` модели; трафик может идти через прокси.

**Речь** (`PC/speech/`): `POST {baseURL}/chat/completions` с частью `input_audio` (WAV, проверка заголовка `RIFF`/`WAVE`, ≤15 МБ, таймаут 30 с); языки `ru`/`en`; расход — сценарий `stt`, входит в суточный лимит; озвучивание выключено.

**Память** (`PC/memory/`): запись ≤2000 символов, раздел ≤12000 токенов (отдельно для личной и проектной партиции). Автосжатие при превышении 90% лимита, не чаще раза в 6 часов, дешёвой моделью (`titleModel`); снимок до сжатия хранится 30 дней (TTL), последнее сжатие можно отменить. Конспекты бесед (`recap.ts`): ≤600 символов, последние 8 попадают в запрос блоком «недавние беседы» (`# Today: <дата>`, строки `- DD.MM «Название» — текст`); сценарии `chat_recap`, `memory_compact`.

## 9. Admin-обработчики и полномочия (`PA/`)

`ADMIN_LEVEL_ROLES = [OWNER, ADMIN]`. `HEAD_CAPABILITIES`: `access:admin`, `read:users`, `read:usage`, `manage:knowledge_documents`, `manage:department_members`, `manage:limit_requests`. Роли `ADMIN`/`OWNER` получают все полномочия при старте.

`resolveDepartmentScope({role, departmentId})`: admin-level — без сужения; `HEAD` — только свой отдел (без отдела — 400); иначе 403. Все обработчики вызывают эту функцию, а не сверяют роль сами.

Модули (каждый проверяет `access:admin` и, где нужно, своё полномочие и scope): `users` (список/карточка/правка настроек AI; `updateUserAiRole` — только admin-level, роли `HEAD`/`USER`), `departments` (промпт/модели/лимиты отдела; имя и описание запрещены — их ведёт справочник), `settings` (глобальные настройки, `modelCapabilities`), `limitRequests` (одобрение с потолком отдела для главы), `spend` (журнал с перепиской и картинками), `usage` (расход сотрудника), `analytics`/`activity`, `feedback`, `knowledge` (CRUD разделов/документов, `reindexSpace`), `models`/`modelCatalog` (каталог провайдера, кэш 20 мин), `balance` (баланс провайдера, кэш 60 с), `capabilities` (`getMyCapabilities`). Пагинация: `DEFAULT_PAGE_LIMIT=50`, `MAX_PAGE_LIMIT=200`; период: `DEFAULT_WINDOW_DAYS=30`.

## 10. Office API

Три роутера под `/api/office`: `admin` (`/admin`), `usage` (`/usage`), `knowledge` (`/knowledge`, для сотрудника), плюс приём уведомлений `POST /api/admin-api/notify`. Полный перечень маршрутов с методами и обработчиками — в [api-reference.md](api-reference.md).

Приём уведомлений: Bearer сервисного клиента обязателен; `claims.azp === (ADMIN_API_NOTIFY_CLIENT||'admin-api-notify')`, `aud` содержит `(ADMIN_API_NOTIFY_AUDIENCE||'corporate-ai')` (иначе 403); тело `{type: employee|department, id: UUID}`; при `ADMIN_API_SYNC_MODE != 'apply'` — 204 без действий; иначе читает сущность из справочника и применяет точечную синхронизацию.

## 11. Синхронизация справочника (`PDIR/`)

**Клиент** (`client.ts`): сконфигурирован при `ADMIN_API_URL` + `ADMIN_API_CLIENT_SECRET` + `OPENID_ISSUER`; сервисный токен `client_credentials` (`client_id = ADMIN_API_CLIENT_ID || 'ai-admin-api'`, кэш до `expires_in − 30 с`); методы `listEmployees`/`listDepartments` (`?include_deleted=true`), `getEmployee`, `getEmployeeBySub`; результат `{ok, value}` / `{ok:false, reason}`.

**Полная сверка** (`sync.ts`): режим `ADMIN_API_SYNC_MODE` (`off`/`report`/`apply`); интервал по умолчанию 60 с (минимум 10 с), первый запуск через 30 с; реентерабельность блокируется. Прогон читает сотрудников и отделы, строит план по каждому; переносятся имя, почта, должность, отдел (через `directoryId`), признак «Админ» → роль `ADMIN`, блокировка (`blocked || deleted_at != null`). Роль `HEAD` при смене отдела сбрасывается в `USER`. При блокировке — `invalidateBlockedUser` и `deleteAllUserSessions`.

**Защита от массовых изменений**: «опасное» изменение — блокировка или понижение admin-роли; при числе опасных изменений за прогон больше `ADMIN_API_SYNC_MAX_CHANGES` (по умолчанию 5) прогон помечается `too_many_changes`, опасные части вырезаются (`stripDangerous`), остальные применяются. Пустой список сотрудников при наличии пользователей в Mongo прерывает прогон (`empty_directory`).

**Точечная синхронизация** (`syncDirectoryEmployee`/`syncDirectoryDepartment`): из `/notify` и провижининга; под блокировкой сотрудника; динамическую защиту «опасных» не применяет (точечное изменение намеренно).

Двойной канал (уведомления + сверка раз в минуту) и защитные пороги обеспечивают отказоустойчивость: даже при потере уведомления изменение подхватится сверкой.
