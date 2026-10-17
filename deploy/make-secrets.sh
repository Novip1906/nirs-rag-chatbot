#!/usr/bin/env bash
# Обязательно: AI_API_KEY. Необязательно: OPENROUTER_API_KEY, TAVILY_API_KEY,
# HTTP_PROXY, HTTPS_PROXY, SMTP_PASSWORD. Повторный запуск ничего не меняет:
# уже созданные значения читаются из кластера.
set -euo pipefail

: "${AI_API_KEY:?Не задана переменная окружения AI_API_KEY}"

NS=corporate

# Значение из секрета или новое, если секрета ещё нет.
keep() {
  local v
  v="$(kubectl -n "$NS" get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null | base64 -d 2>/dev/null || true)"
  if [ -n "$v" ]; then printf '%s' "$v"; else openssl rand -hex "$3"; fi
}

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

MINIO_ACCESS_KEY="corporate"
MINIO_SECRET_KEY="$(keep minio-credentials secretKey 24)"
ADMIN_API_CLIENT_SECRET="$(keep librechat-secrets ADMIN_API_CLIENT_SECRET 24)"
OPENID_CLIENT_SECRET="$(keep librechat-secrets OPENID_CLIENT_SECRET 24)"
KEYCLOAK_ADMIN_CLIENT_SECRET="$(keep admin-api keycloak_admin_client_secret 24)"
NOTIFY_CLIENT_SECRET="$(keep admin-api notify_client_secret 24)"

args=(
  --from-literal=CREDS_KEY="$(keep librechat-secrets CREDS_KEY 32)"
  --from-literal=CREDS_IV="$(keep librechat-secrets CREDS_IV 16)"
  --from-literal=JWT_SECRET="$(keep librechat-secrets JWT_SECRET 32)"
  --from-literal=JWT_REFRESH_SECRET="$(keep librechat-secrets JWT_REFRESH_SECRET 32)"
  --from-literal=OPENID_SESSION_SECRET="$(keep librechat-secrets OPENID_SESSION_SECRET 32)"
  --from-literal=OPENID_CLIENT_SECRET="$OPENID_CLIENT_SECRET"
  --from-literal=ADMIN_API_CLIENT_SECRET="$ADMIN_API_CLIENT_SECRET"
  --from-literal=POSTGRES_PASSWORD="$(keep librechat-secrets POSTGRES_PASSWORD 24)"
  --from-literal=KNOWLEDGE_S3_ACCESS_KEY="$MINIO_ACCESS_KEY"
  --from-literal=KNOWLEDGE_S3_SECRET_KEY="$MINIO_SECRET_KEY"
  --from-literal=AI_API_KEY="$AI_API_KEY"
)
for v in OPENROUTER_API_KEY TAVILY_API_KEY HTTP_PROXY HTTPS_PROXY; do
  [ -z "${!v:-}" ] || args+=("--from-literal=$v=${!v}")
done
kubectl -n "$NS" create secret generic librechat-secrets "${args[@]}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic admin-api \
  --from-literal=db_password="$(keep admin-api db_password 24)" \
  --from-literal=keycloak_admin_client_secret="$KEYCLOAK_ADMIN_CLIENT_SECRET" \
  --from-literal=notify_client_secret="$NOTIFY_CLIENT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic keycloak-db \
  --from-literal=password="$(keep keycloak-db password 24)" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic keycloak-admin \
  --from-literal=username="admin" \
  --from-literal=password="$(keep keycloak-admin password 24)" \
  --dry-run=client -o yaml | kubectl apply -f -

# Ключи MinIO одни и те же для хранилища и для LibreChat.
kubectl -n "$NS" create secret generic minio-credentials \
  --from-literal=accessKey="$MINIO_ACCESS_KEY" \
  --from-literal=secretKey="$MINIO_SECRET_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

if [ -n "${SMTP_PASSWORD:-}" ]; then
  kubectl -n "$NS" create secret generic keycloak-smtp \
    --from-file=password=<(printf '%s' "$SMTP_PASSWORD") \
    --dry-run=client -o yaml | kubectl apply -f -
fi

echo "Секреты применены."
