#!/usr/bin/env bash
# Создаёт первого администратора: учётную запись в Keycloak и запись в Mongo с ролью ADMIN.
# Использование: ./create-admin.sh <email> [имя]
# ADMIN_PASSWORD задаёт постоянный пароль, иначе генерируется временный.
# ADMIN_ROLE=OWNER выдаёт роль OWNER вместо ADMIN.
set -euo pipefail
cd "$(dirname "$0")"

EMAIL="${1:?Укажите email администратора}"
NAME="${2:-Администратор}"
ROLE="${ADMIN_ROLE:-ADMIN}"
REALM="corporate"
ISSUER="https://auth.example.com/realms/$REALM"

kubectl -n corporate port-forward svc/keycloak 18080:80 >/dev/null 2>&1 &
PF_PID=$!
TMP="$(mktemp -d)"
trap 'kill "$PF_PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
KC="http://127.0.0.1:18080"
for _ in $(seq 1 30); do
  curl -sS -o /dev/null --max-time 2 "$KC/realms/master" 2>/dev/null && break
  sleep 1
done

KC_USER="$(kubectl -n corporate get secret keycloak-admin -o jsonpath='{.data.username}' | base64 -d)"
KC_PASS="$(kubectl -n corporate get secret keycloak-admin -o jsonpath='{.data.password}' | base64 -d)"
TOKEN="$(curl -sS -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d "username=$KC_USER" -d "password=$KC_PASS" -d grant_type=password \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

if [ -n "${ADMIN_PASSWORD:-}" ]; then
  PASSWORD="$ADMIN_PASSWORD"
  TEMPORARY=false
else
  PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  TEMPORARY=true
fi

code="$(curl -sS -o "$TMP/kc-user-resp" -w '%{http_code}' -X POST "$KC/admin/realms/$REALM/users" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$(python3 -c '
import json,sys
email, name, pwd, temp = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "true"
first = name.split()[0] if name.split() else name
last = " ".join(name.split()[1:])
print(json.dumps({
  "username": email, "email": email, "firstName": first, "lastName": last,
  "enabled": True, "emailVerified": True,
  "requiredActions": ["UPDATE_PASSWORD"] if temp else [],
  "credentials": [{"type": "password", "value": pwd, "temporary": temp}],
}))' "$EMAIL" "$NAME" "$PASSWORD" "$TEMPORARY")")"

case "$code" in
  201) echo "Keycloak: пользователь $EMAIL создан." ;;
  409) echo "Keycloak: пользователь $EMAIL уже есть, пароль не менялся."; PASSWORD='(прежний)' ;;
  *)   echo "Keycloak вернул HTTP $code:"; cat "$TMP/kc-user-resp"; exit 1 ;;
esac

KC_ID="$(curl -sS -H "Authorization: Bearer $TOKEN" \
  "$KC/admin/realms/$REALM/users?username=$EMAIL&exact=true" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if d else "")')"
[ -n "$KC_ID" ] || { echo "Не нашёл созданного пользователя в Keycloak"; exit 1; }

kubectl -n corporate exec mongodb-0 -- mongosh LibreChat --quiet --eval "
const email = $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$EMAIL");
const existing = db.users.findOne({ email });
if (existing) {
  db.users.updateOne({ _id: existing._id }, { \$set: { role: '$ROLE', updatedAt: new Date() } });
  print('Mongo: у существующей записи выставлена роль $ROLE.');
} else {
  const now = new Date();
  db.users.insertOne({
    username: email, email, emailVerified: true, avatar: null,
    provider: 'openid', role: '$ROLE',
    openidIssuer: '$ISSUER', employeeId: '$KC_ID',
    plugins: [], refreshToken: [], favorites: [], backupCodes: [], pendingBackupCodes: [],
    personalization: {}, skillStates: {},
    twoFactorEnabled: false, termsAccepted: false, termsAcceptedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  });
  print('Mongo: запись администратора создана.');
}
" 2>&1 | grep -v "^$"

echo
echo "Администратор: $EMAIL (роль $ROLE)"
if [ "$TEMPORARY" = true ]; then
  echo "Временный пароль: $PASSWORD — Keycloak попросит сменить его при первом входе."
else
  echo "Пароль задан вызывающим, смена при входе не требуется."
fi
echo "Вход: https://ai.example.com/"
