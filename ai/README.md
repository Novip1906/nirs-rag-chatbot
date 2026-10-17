# Corporate AI — чат-ассистент

Чат с языковыми моделями и поиском по корпоративной базе знаний (RAG). Основан на [LibreChat](https://github.com/danny-avila/LibreChat) (лицензия MIT, см. `LICENSE`); поверх него добавлены база знаний с разделами и правами отделов, вход через Keycloak, лимиты и расходы по сотрудникам и отделам, DLP-фильтр, документы пользователя, память, генерация изображений с подтверждением и серверная часть для админ-панели.

Устройство системы целиком — в [`../docs/architecture.md`](../docs/architecture.md), требования — в [`../docs/specification.md`](../docs/specification.md).

## Состав

| Каталог | Что внутри |
|---|---|
| `api/` | Express-сервер: маршруты, middleware, инструменты агентов |
| `packages/api/` | Серверная логика на TypeScript; доработки проекта — `src/corporate/` и `src/admin/corporate/` |
| `packages/data-schemas/` | Схемы и методы MongoDB |
| `packages/data-provider/` | Общие типы и клиент API для фронтенда и сервера |
| `packages/client/` | Общие компоненты интерфейса |
| `client/` | Веб-интерфейс чата (React, Vite) |
| `deploy/` | Манифесты Kubernetes: чат, MongoDB, pgvector, rag-api, Keycloak, MinIO, админ-панель |

## Команды

Node.js 24 (см. `.nvmrc`), команды выполняются из этого каталога.

```bash
npm ci
npm run build:packages   # собрать packages/*
npm run backend:dev      # сервер на http://localhost:3080
npm run frontend:dev     # интерфейс в режиме разработки
npm run frontend         # production-сборка интерфейса
```

Тесты: `npm run test:api`, `npm run test:client`, `npm run test:packages:api`, `npm run test:packages:data-schemas`.

## Настройка

- `.env` — по образцу `.env.example`; для развёртывания значения заданы в `deploy/10-config.yaml` и секрете `librechat-secrets` (создаёт `../deploy/make-secrets.sh`).
- `librechat.yaml` — эндпоинт модели, интерфейс, база знаний и DLP; рабочая версия лежит в `deploy/10-config.yaml`.
- Ключ провайдера моделей передаётся только через переменные окружения (`AI_API_KEY`, `AI_BASE_URL`) и в репозиторий не попадает.
