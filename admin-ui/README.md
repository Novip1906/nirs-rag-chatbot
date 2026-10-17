# Corporate Admin

Админ-панель корпоративного ИИ-ассистента Corporate. Разделы: сотрудники, отделы, база знаний (пространства и документы), расходы и лимиты, аналитика, отзывы, промпты, память.

Стек: React, TypeScript, Vite, TanStack Query, Tailwind CSS. Тесты: Jest и Testing Library.

## Команды

```
npm ci
npm run dev
npm test
npm run build
npm run lint
```

`npm run build` проверяет типы (`tsc --noEmit`) и собирает статику в `dist/`.

## Конфигурация

Переменные окружения Vite (`.env` или `--build-arg` в Dockerfile):

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3080` | API ассистента |
| `VITE_ADMIN_API_URL` | `/api` | Admin API (`<url>/admin/v1/...`) |
| `VITE_CHAT_URL` | `http://localhost:3090` | Ссылка на интерфейс чата |
| `VITE_OIDC_ISSUER` | `http://localhost:8080/realms/corporate` | OIDC-провайдер |
| `VITE_OIDC_CLIENT_ID` | `admin` | OIDC client id (вход через authorization code с PKCE) |

Для работы нужны запущенные бэкенд и OIDC-провайдер. В `Dockerfile` приложение собирается и отдаётся через nginx на порту 80 (`/health` для проверки).
