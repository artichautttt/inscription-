#!/usr/bin/env bash
# Deploie le canary sur le serveur (apres deploy-base.sh). Idempotent. NE reexecute PAS deploy-base.sh ensuite
# (il reecrit les .env) ; si tu le fais, relance ce script.
# Prerequis : ~/.canary-secrets (chmod 600) contenant les deux lignes :
#   UNLEASH_CLIENT_TOKEN=...   (token Backend SDK)
#   UNLEASH_ADMIN_TOKEN=...    (token admin / personnel)
set -euo pipefail
APP=~/app
SEC=~/.canary-secrets
[ -f "$SEC" ] || { echo "Manque $SEC"; exit 1; }
set -a; . "$SEC"; set +a
[ -n "${UNLEASH_CLIENT_TOKEN:-}" ] && [ -n "${UNLEASH_ADMIN_TOKEN:-}" ] || { echo "Tokens manquants dans $SEC"; exit 1; }

echo "== build gateway (canary)"
cd $APP/gateway && npm install --no-audit --no-fund && npm run build

echo "== .env du gateway"
cd $APP/gateway
sed -i '/^\(UNLEASH_URL\|UNLEASH_CLIENT_TOKEN\|UNLEASH_REFRESH_MS\|COURSES_V2_SERVICE_URL\|CANARY_WINDOW_MS\|UPSTREAM_TIMEOUT_MS\)=/d' .env
cat >> .env <<ENV
UNLEASH_URL=http://127.0.0.1:4242/api/
UNLEASH_CLIENT_TOKEN=$UNLEASH_CLIENT_TOKEN
UNLEASH_REFRESH_MS=2000
COURSES_V2_SERVICE_URL=http://127.0.0.1:3012
CANARY_WINDOW_MS=10000
UPSTREAM_TIMEOUT_MS=3000
ENV
chmod 600 .env

echo "== courses-v2 (meme build que courses, port 3012)"
M=$(find $APP/courses/dist -name main.js | head -1)
pm2 delete courses-v2 2>/dev/null || true
PORT=3012 pm2 start "$M" --name courses-v2 --cwd $APP/courses --node-args="--env-file=$APP/courses/.env" --update-env

echo "== redemarrage du gateway"
pm2 restart gateway --update-env

echo "== rollback-watcher"
pm2 delete rollback-watcher 2>/dev/null || true
mkdir -p ~/canary-results
UNLEASH_ADMIN_TOKEN="$UNLEASH_ADMIN_TOKEN" EVENTS_FILE=~/canary-results/events.jsonl \
  pm2 start $APP/canary-simulation/rollback-watcher/watcher.js --name rollback-watcher --update-env
pm2 save
sleep 6
echo "== verifications"
curl -s -o /dev/null -w "courses v1 : %{http_code}\n" http://127.0.0.1:3002/courses
curl -s -o /dev/null -w "courses v2 : %{http_code}\n" http://127.0.0.1:3012/courses
curl -s http://127.0.0.1:3000/internal/canary-metrics; echo
pm2 status
