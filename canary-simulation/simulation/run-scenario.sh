#!/usr/bin/env bash
# Usage : run-scenario.sh <A|B|C|D|E> <numero_de_run>
#   A sain (aucune panne) | B panne franche (pm2 stop courses-v2) | C degradation (SIGSTOP)
#   D panne + recovery MANUEL | E panne + recovery AUTOMATIQUE (le watcher reactive le flag seul)
# Resultats : ~/canary-results/<scenario>-<run>/{load.csv,events.jsonl,summary.json}
set -euo pipefail
SC=${1:?scenario A|B|C|D}; RUN=${2:-1}
SEC=~/.canary-secrets; set -a; . "$SEC"; set +a
APP=~/app; DIR=~/canary-results/$SC-$RUN; mkdir -p "$DIR"; rm -f "$DIR"/*
EV=$DIR/events.jsonl
FLAG=courses-v2-canary; PROJECT=default; ENVIRONMENT=development
ADMIN=http://127.0.0.1:4242/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT
DURATION=${DURATION:-90}; FAULT_AT=${FAULT_AT:-20}; RECOVER_AT=${RECOVER_AT:-60}
[ "$SC" = E ] && { DURATION=${DURATION_E:-110}; RECOVER_AT=${RECOVER_AT_E:-50}; }
if [ "$SC" = E ]; then export AUTO_RECOVERY=1; else export AUTO_RECOVERY=0; fi
now() { date +%s%3N; }
ev() { echo "{\"event\":\"$1\",\"at\":$(now)}" >> "$EV"; }
flag() { curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: $UNLEASH_ADMIN_TOKEN" "$ADMIN/$1"; }

echo "[$SC-$RUN] remise a l'etat initial"
pm2 sendSignal SIGCONT courses-v2 >/dev/null 2>&1 || true
pm2 start courses-v2 >/dev/null 2>&1 || true
echo "  flag on -> HTTP $(flag on)"
pm2 delete rollback-watcher >/dev/null 2>&1 || true
UNLEASH_ADMIN_TOKEN="$UNLEASH_ADMIN_TOKEN" EVENTS_FILE=$EV pm2 start $APP/canary-simulation/rollback-watcher/watcher.js --name rollback-watcher --update-env >/dev/null
sleep 8   # le SDK du gateway recharge le flag (refresh 2 s) et la fenetre de metriques se vide
curl -s -o /dev/null -w "  v2 sain : %{http_code}\n" http://127.0.0.1:3012/courses

echo "[$SC-$RUN] charge pendant ${DURATION}s"
node $APP/canary-simulation/simulation/load.js --duration $DURATION --rps 20 --users 200 --out "$DIR/load.csv" &
LOAD=$!
sleep $FAULT_AT
case $SC in
  A) ;;
  B|D|E) pm2 stop courses-v2 >/dev/null; ev fault_injected ;;   # horodate une fois le service reellement arrete
  C)   pm2 sendSignal SIGSTOP courses-v2 >/dev/null; ev fault_injected ;;
  *) echo "scenario inconnu"; kill $LOAD; exit 1 ;;
esac
if [ "$SC" = E ]; then
  sleep $((RECOVER_AT - FAULT_AT))
  echo "[$SC-$RUN] recovery AUTOMATIQUE : on redemarre seulement courses-v2 ; le watcher doit reactiver le flag seul"
  pm2 start courses-v2 >/dev/null; ev v2_restarted
fi
if [ "$SC" = D ]; then
  sleep $((RECOVER_AT - FAULT_AT))
  echo "[$SC-$RUN] recovery : redemarrage de courses-v2 puis reactivation MANUELLE du flag"
  pm2 start courses-v2 >/dev/null; ev v2_restarted
  for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3012/courses)" = 200 ] && break; sleep 1; done
  ev v2_healthy
  echo "  flag on -> HTTP $(flag on)"; ev flag_reenabled
  pm2 restart rollback-watcher --update-env >/dev/null   # rearme la surveillance (le watcher ne reactive jamais seul)
  # La verification du recovery se fait sur les mesures (load.csv), pas ici : voir summarize.js
fi
wait $LOAD
pm2 sendSignal SIGCONT courses-v2 >/dev/null 2>&1 || true
pm2 start courses-v2 >/dev/null 2>&1 || true
node $APP/canary-simulation/simulation/summarize.js "$DIR/load.csv" "$EV" > "$DIR/summary.json"
echo "[$SC-$RUN] termine -> $DIR/summary.json"; cat "$DIR/summary.json"
