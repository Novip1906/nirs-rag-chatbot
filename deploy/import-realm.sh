#!/usr/bin/env bash
# Создаёт realm corporate: клиенты, роли, мапперы и тема, без пользователей.
# Секреты клиентов берутся из кластера (их создаёт make-secrets.sh).
set -euo pipefail
umask 077
cd "$(dirname "$0")"

NS=corporate
secret() {
  kubectl -n "$NS" get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null | base64 -d 2>/dev/null || true
}
need() {
  local v
  v="$(secret "$1" "$2")"
  [ -n "$v" ] || { echo "Нет значения $2 в секрете $1: запустите make-secrets.sh" >&2; exit 1; }
  printf '%s' "$v"
}

OPENID_CLIENT_SECRET="$(need librechat-secrets OPENID_CLIENT_SECRET)"
AI_ADMIN_API_CLIENT_SECRET="$(need librechat-secrets ADMIN_API_CLIENT_SECRET)"
ADMIN_API_ADMIN_CLIENT_SECRET="$(need admin-api keycloak_admin_client_secret)"
ADMIN_API_NOTIFY_CLIENT_SECRET="$(need admin-api notify_client_secret)"
KC_USER="$(need keycloak-admin username)"
KC_PASS="$(need keycloak-admin password)"
SMTP_PASSWORD="$(secret keycloak-smtp password)"

kubectl -n "$NS" port-forward svc/keycloak 18080:80 >/dev/null 2>&1 &
PF_PID=$!
TMP="$(mktemp -d)"
trap 'kill "$PF_PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
KC_URL="http://127.0.0.1:18080"
for _ in $(seq 1 60); do
  curl -sSf -o /dev/null --max-time 2 "$KC_URL/realms/master" 2>/dev/null && break
  sleep 2
done

TOKEN="$(curl -sS -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d "username=$KC_USER" -d "password=$KC_PASS" -d grant_type=password \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

OPENID_CLIENT_SECRET="$OPENID_CLIENT_SECRET" \
AI_ADMIN_API_CLIENT_SECRET="$AI_ADMIN_API_CLIENT_SECRET" \
ADMIN_API_ADMIN_CLIENT_SECRET="$ADMIN_API_ADMIN_CLIENT_SECRET" \
ADMIN_API_NOTIFY_CLIENT_SECRET="$ADMIN_API_NOTIFY_CLIENT_SECRET" \
SMTP_PASSWORD="$SMTP_PASSWORD" \
python3 - <<'PY' > "$TMP/realm.json"
import json, os, sys
d = json.load(open('realm-corporate.json'))
subst = {
    '__OPENID_CLIENT_SECRET__': os.environ['OPENID_CLIENT_SECRET'],
    '__AI_ADMIN_API_CLIENT_SECRET__': os.environ['AI_ADMIN_API_CLIENT_SECRET'],
    '__ADMIN_API_ADMIN_CLIENT_SECRET__': os.environ['ADMIN_API_ADMIN_CLIENT_SECRET'],
    '__ADMIN_API_NOTIFY_CLIENT_SECRET__': os.environ['ADMIN_API_NOTIFY_CLIENT_SECRET'],
}
for c in d['clients']:
    if c.get('secret') in subst:
        c['secret'] = subst[c['secret']]
if d['smtpServer'].get('password') == '__SMTP_PASSWORD__':
    d['smtpServer']['password'] = os.environ['SMTP_PASSWORD']
json.dump(d, sys.stdout)
PY

code="$(curl -sS -o "$TMP/response" -w '%{http_code}' -X POST "$KC_URL/admin/realms" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary @"$TMP/realm.json")"

case "$code" in
  201) echo "Realm corporate создан." ;;
  409) echo "Realm corporate уже есть — импорт пропущен." ;;
  *)   echo "Импорт не прошёл, HTTP $code:"; cat "$TMP/response"; exit 1 ;;
esac
