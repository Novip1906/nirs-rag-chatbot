# Спецификация: развёртывание

Система разворачивается в Kubernetes (пространство имён `corporate`) средствами Kustomize. Обзор топологии — в [architecture.md](../architecture.md), §5; здесь собраны конкретные манифесты, realm Keycloak, секреты и переменные, достаточные для поднятия стенда.

## 1. Состав и образы

| Компонент | Образ / тип | Порт | Ресурсы (лимит памяти) |
|---|---|---|---|
| `librechat` (сервер + чат) | `ghcr.io/novip1906/corporate-ai` (Node.js/Express/React) | 3080 | 1100 МиБ |
| `adminui` (админ-панель) | `ghcr.io/novip1906/corporate-admin-ui` (nginx со статикой) | 80 | 64 МиБ |
| `admin-api` (сервис сотрудников) | образ Go (distroless) | 8091 | 384 МиБ (`GOMEMLIMIT=300MiB`) |
| `keycloak` | `quay.io/keycloak/keycloak:26.7.2` + тема `corporate` + magic link | 8080 | 700 МиБ |
| `rag-api` | `librechat-rag-api-dev-lite` | 8000 | 700 МиБ |
| `vectordb` | `pgvector/pgvector:0.8.0-pg15` (база `ragdb`) | 5432 | 512 МиБ |
| `mongodb` | `mongo:8.0` | 27017 | 700 МиБ |
| `minio` | MinIO (S3, бакет `knowledge`) | 9000 | 400 МиБ |
| `admin-api-db` | `postgres:16` | 5432 | 256 МиБ |
| `keycloak-db` | `postgres:16` | 5432 | 300 МиБ |

Каждый сервис — один экземпляр. У `admin-api`, `rag-api`, `vectordb` стратегия обновления `Recreate`; у `librechat` — `RollingUpdate` с `maxUnavailable: 0` и пробами по `/health` (обновление без простоя).

## 2. Манифесты `ai/deploy`

Пронумерованы в порядке применения.

| Файл | Что создаёт |
|---|---|
| `00-namespace.yaml` | пространство имён `corporate` |
| `10-config.yaml` | `ConfigMap librechat-env` (переменные окружения) и `librechat-yaml` (`librechat.yaml`) |
| `20-mongo.yaml` | `StatefulSet mongodb` (PVC 5 ГиБ, кэш WiredTiger 0,25 ГБ), headless-сервис |
| `30-librechat.yaml` | `Deployment librechat` (`RollingUpdate`, `envFrom` из `librechat-env` + `librechat-secrets`), сервис 80→3080, два PVC: `librechat-data` 3 ГиБ (`uploads`, `logs`, `images`), `knowledge-data` 10 ГиБ (оригиналы при работе без S3). `librechat.yaml` монтируется из ConfigMap. Пробы startup/readiness/liveness по `GET /health` |
| `40-ingress.yaml` | ingress чата (вне базовой сборки; в оверлее заменяется) |
| `50-vectordb.yaml` | `Deployment vectordb` (`Recreate`), PVC 5 ГиБ |
| `60-rag-api.yaml` | `Deployment rag-api`, init-контейнер ждёт `vectordb`; переменные `VECTOR_DB_TYPE=pgvector`, `EMBEDDINGS_PROVIDER=openai`, `EMBEDDINGS_MODEL=baai/bge-m3`, `RAG_CHECK_EMBEDDING_CTX_LENGTH=False`, адрес и ключ провайдера для эмбеддингов, база `ragdb`/`raguser` |
| `70-keycloak-db.yaml` | `StatefulSet keycloak-db`, PVC 2 ГиБ |
| `71-keycloak.yaml` | `Deployment keycloak` (`start`), init-контейнер ждёт БД, `ConfigMap` с темами входа и писем; расширение magic link подключается патчем через `ConfigMap keycloak-magic-link-jar` |
| `72-keycloak-ingress.yaml` | ingress Keycloak (вне базовой сборки) |
| `80-adminui.yaml` | `Deployment adminui`, сервис 80 |
| `81-adminui-ingress.yaml` | ingress админ-панели (вне базовой сборки) |
| `90-minio.yaml` | `StatefulSet minio`, PVC 5 ГиБ |
| `kustomization.yaml` | базовая сборка без ingress, генератор `ConfigMap` для jar |
| `keycloak/` | тема `corporate` (вход, письма) и jar расширения magic link |

## 3. Манифесты `admin-api/deploy`

| Файл | Что создаёт |
|---|---|
| `10-admin-api-db.yaml` | `StatefulSet admin-api-db` (`postgres:16`), PVC 2 ГиБ |
| `20-admin-api.yaml` | `ConfigMap admin-api`, сервис 8091, `Deployment admin-api` (`Recreate`): init-контейнер `migrate`, контейнер `serve`; пробы `/health` |
| `kustomization.yaml` | сборка из двух файлов выше |

Базовая сборка `admin-api` сама не запускается: обязательные `PUBLIC_BASE_URL`, `INVITE_CLIENT_ID`, `INVITE_REDIRECT_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URL`, `KEYCLOAK_ADMIN_URL`, `NOTIFY_URLS` задаёт оверлей.

## 4. Оверлей `deploy/` (стенд целиком)

`kubectl apply -k deploy` собирает всё. Порядок и сборка образов — в [deploy/README.md](../../deploy/README.md).

| Файл | Назначение |
|---|---|
| `kustomization.yaml` | подключает `ai/deploy` и `admin-api/deploy`, добавляет ресурсы и патчи |
| `ingress.yaml` | ingress `ai.*` (чат), `admin.*` (панель; `admin.*/api` → `admin-api`), `auth.*` (Keycloak); ограничение частоты сброса пароля |
| `embeddings.yaml`, `patch-rag-api.yaml` | локальный сервис эмбеддингов (Text Embeddings Inference, `BAAI/bge-m3`): тексты документов при индексации не покидают кластер |
| `minio-bucket.yaml` | Job создания бакета `knowledge` |
| `patch-keycloak.yaml` | публичный адрес Keycloak и подключение jar magic link |
| `patch-librechat-env.yaml`, `patch-admin-api-config.yaml` | адреса окружения, режим синхронизации `apply`, адреса уведомлений и приглашений |
| `realm-corporate.json`, `import-realm.sh` | realm `corporate` (клиенты, аудитории, роли, темы) |
| `make-secrets.sh`, `create-admin.sh` | создание секретов и первого администратора |

Синхронизация справочника в базовых манифестах — режим `report`; оверлей включает `apply` (без него не создаются пользователи по первому входу).

## 5. Keycloak: realm и клиенты

Realm `corporate`. Клиенты:

| Клиент | Тип | Назначение |
|---|---|---|
| `librechat` | конфиденциальный, OIDC | вход в чат |
| `admin` | публичный, PKCE | вход в админ-панель; аудитории `admin-api` и `corporate-ai` |
| `admin-api` | сервисный (`client_credentials`), роль `manage-users` | admin REST и magic link |
| `admin-api-notify` | сервисный, без ролей | уведомления серверу ассистента; аудитория `corporate-ai` |
| `ai-admin-api` | сервисный | чтение справочника сервером ассистента (должен входить в `READER_CLIENTS`) |

Загружено расширение magic link (jar собирается отдельно под используемую версию Keycloak). Тема `corporate` задаёт форму входа и письма-приглашения. Вход только через Keycloak (PKCE), локальный пароль отключён; аварийный возврат — `ALLOW_EMAIL_LOGIN_OVERRIDE`.

## 6. Секреты

Значения в репозитории не хранятся; имена — из манифестов и `deploy/make-secrets.sh`.

| Секрет | Ключи |
|---|---|
| `librechat-secrets` | `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `AI_API_KEY`, `OPENROUTER_API_KEY`, `POSTGRES_PASSWORD`, `ADMIN_API_CLIENT_SECRET`, `KNOWLEDGE_S3_ACCESS_KEY`, `KNOWLEDGE_S3_SECRET_KEY`, `TAVILY_API_KEY`, `OPENID_CLIENT_SECRET`, `HTTPS_PROXY`/`HTTP_PROXY` |
| `keycloak-db` | `password` |
| `keycloak-admin` | `username`, `password` |
| `minio-credentials` | `accessKey`, `secretKey` |
| `admin-api` | `db_password`, `keycloak_admin_client_secret`, `notify_client_secret` (при резервном копировании — `backup_dsn`) |
| сертификаты | `corporate-tls`, `adminui-tls` (cert-manager) |

## 7. Переменные конфигурации

### 7.1. Сервер ассистента (`librechat-env`)

Провайдер (`AI_PROVIDER`, `AI_BASE_URL`, `OPENROUTER_BASE_URL`, `RUB_PER_USD`), вход (`OPENID_*`, `ADMIN_OIDC_AUDIENCE`, `ADMIN_OIDC_CLIENT`, `ALLOW_REGISTRATION=false`, `ALLOW_EMAIL_LOGIN=false`), справочник (`ADMIN_API_URL`, `ADMIN_API_CLIENT_ID=ai-admin-api`, `ADMIN_API_NOTIFY_CLIENT`, `ADMIN_API_NOTIFY_AUDIENCE`, `ADMIN_API_SYNC_MODE`, `ADMIN_API_SYNC_INTERVAL_MS=60000`, `ADMIN_API_SYNC_MAX_CHANGES=5`), хранилище базы знаний (`KNOWLEDGE_S3_ENDPOINT=http://minio:9000`, `KNOWLEDGE_S3_BUCKET=knowledge`, `KNOWLEDGE_S3_REGION`), RAG (`RAG_API_URL=http://rag-api:8000`), `MONGO_URI`, `TZ=Europe/Moscow`, `NO_PROXY`.

### 7.2. Сервис сотрудников (`admin-api`)

Полный перечень — в [admin-api.md](admin-api.md), §11. Обязательные: `PUBLIC_BASE_URL`, `POSTGRES_DSN`, `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URL`, `KEYCLOAK_ADMIN_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_ADMIN_CLIENT_SECRET`, `INVITE_CLIENT_ID`, `INVITE_REDIRECT_URL`; при уведомлениях — `NOTIFY_URLS`, `NOTIFY_CLIENT_SECRET`; `READER_CLIENTS` должен содержать `ai-admin-api`.

### 7.3. Админ-панель (`adminui`, build-args)

`VITE_API_BASE_URL` (office API), `VITE_ADMIN_API_URL` (сервис сотрудников), `VITE_CHAT_URL`, `VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID=admin`.

## 8. Хранение данных

| Данные | Хранилище |
|---|---|
| Беседы, пользователи, политики, настройки AI, отделы (зеркало), журнал расходов, метаданные базы знаний, память, проекты | MongoDB |
| Векторный индекс документов | PostgreSQL + pgvector (`ragdb`) |
| Оригиналы документов базы знаний | MinIO (бакет `knowledge`) либо диск |
| Сотрудники, отделы, фото, журнал действий | PostgreSQL `admin-api` |
| Учётные записи и сессии входа | PostgreSQL Keycloak |
| Вложения и сгенерированные картинки | том сервера ассистента |

## 9. Эксплуатация

- Часовой пояс процессов `Europe/Moscow` определяет границу суток для лимитов.
- Миграции `admin-api` выполняет init-контейнер (`admin-api migrate`).
- Первый администратор создаётся `deploy/create-admin.sh`; команда `admin-api import` переносит сотрудников и отделы из Keycloak (режим проверки без `--apply`).
- Смена провайдера, моделей и настроек `librechat.yaml` требует перезапуска пода.
- Эмбеддинги в оверлее строит локальный сервис — тексты документов не покидают кластер; при внешнем `rag-api` тексты уходят к провайдеру (с маскированием DLP при `maskEmbeddings`).
