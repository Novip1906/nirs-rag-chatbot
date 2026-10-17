# Развёртывание Corporate в Kubernetes

Оверлей поверх `ai/deploy` и `admin-api/deploy`: namespace `corporate`, Ingress, локальные эмбеддинги (TEI, BAAI/bge-m3), бакет MinIO `knowledge`, Keycloak с realm `corporate`.

## Требования

- Кластер Kubernetes с ingress-nginx и cert-manager. Должен существовать `ClusterIssuer` `letsencrypt` (имя задано в `ingress.yaml`, аннотация `cert-manager.io/cluster-issuer`).
- `kubectl`, `openssl`, `curl`, `python3` на машине, с которой выполняются шаги.
- Собранные и доступные кластеру образы:

```sh
docker build -t ghcr.io/novip1906/corporate-ai:latest -f ai/Dockerfile ai
docker build -t ghcr.io/novip1906/corporate-admin-ui:latest \
  --build-arg VITE_API_BASE_URL=https://ai.example.com \
  --build-arg VITE_CHAT_URL=https://ai.example.com \
  --build-arg VITE_OIDC_ISSUER=https://auth.example.com/realms/corporate \
  --build-arg VITE_OIDC_CLIENT_ID=admin \
  --build-arg VITE_ADMIN_API_URL=/api \
  admin-ui
docker build -t ghcr.io/novip1906/corporate-admin-api:latest admin-api
docker push ghcr.io/novip1906/corporate-ai:latest   # и остальные два образа
```

Если реестр приватный, создайте `imagePullSecret` и привяжите его к `default` ServiceAccount в namespace `corporate`.

## Домены

В файлах ниже `ai.example.com`, `admin.example.com` и `auth.example.com` — заглушки. Замените их на свои домены; DNS-записи должны указывать на ingress-контроллер, а имена должны разрешаться и из подов (admin-api и LibreChat обращаются к `auth.*` по публичному адресу).

```sh
grep -rl example.com deploy ai/deploy | xargs sed -i 's/ai\.example\.com/chat.mycompany.ru/g; s/admin\.example\.com/admin.mycompany.ru/g; s/auth\.example\.com/auth.mycompany.ru/g'
```

Затронуты `deploy/*.yaml`, `deploy/realm-corporate.json`, `deploy/create-admin.sh` и `ai/deploy/10-config.yaml`. Адрес `smtp.example.com` и отправитель `noreply@example.com` в `realm-corporate.json` замените на данные своей почты; без SMTP не работают приглашения и сброс пароля.

## Порядок запуска

Команды выполняются из корня репозитория.

1. Секреты (обязателен только `AI_API_KEY`; `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `HTTP_PROXY`, `HTTPS_PROXY`, `SMTP_PASSWORD` — по необходимости):

   ```sh
   AI_API_KEY=... SMTP_PASSWORD=... ./deploy/make-secrets.sh
   ```

   Скрипт идемпотентен: существующие значения не перегенерируются.

2. Манифесты:

   ```sh
   kubectl apply -k deploy
   kubectl -n corporate rollout status deploy/keycloak
   ```

   Из-за ConfigMap с jar-файлом Keycloak, если `apply` падает с `Too long`, используйте `kubectl apply -k deploy --server-side`.

3. Realm Keycloak (клиенты, роли, тема; секреты клиентов берутся из кластера):

   ```sh
   ./deploy/import-realm.sh
   ```

4. Первый администратор:

   ```sh
   ./deploy/create-admin.sh admin@mycompany.ru "Имя Фамилия"
   ```

5. Откройте https://admin.example.com и войдите этой учётной записью.

Сборка проверяется командой `kubectl kustomize deploy`.
