#!/usr/bin/env bash
# boarz-stats share instance — standalone SvelteKit (adapter-node) server bound
# to 0.0.0.0 on an uncommon port, pinned after first pick so tunnel targets
# never change. Read-only: STATS_ONLY=1 skips every background worker and 404s
# all non-share routes.
#
#   scripts/serve-boarz-stats.sh [--rebuild]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_FILE="$ROOT/.boarz-stats-port"

if [[ "${1:-}" == "--rebuild" ]]; then
	echo "[boarz-stats] building ui..."
	(cd "$ROOT/ui" && npm run build)
fi

if [[ ! -f "$ROOT/ui/build/index.js" ]]; then
	echo "[boarz-stats] ui/build missing — run with --rebuild first" >&2
	exit 1
fi

if [[ -f "$PORT_FILE" ]]; then
	PORT="$(cat "$PORT_FILE")"
else
	# uncommon range, skipping anything registered/well-known
	PORT="$(shuf -i 21451-39999 -n 1)"
	while ss -ltn "( sport = :$PORT )" | grep -q LISTEN; do
		PORT="$(shuf -i 40000-59999 -n 1)"
	done
	echo "$PORT" > "$PORT_FILE"
	echo "[boarz-stats] picked port $PORT (pinned in .boarz-stats-port)"
fi

echo "[boarz-stats] serving on http://0.0.0.0:$PORT/boarz-stats"
echo $$ > "$ROOT/.boarz-stats-pid"
cd "$ROOT/ui"
# chat topic summaries need OPENROUTER_API_KEY
if [[ -f "$ROOT/.env" ]]; then
	set -a
	. "$ROOT/.env"
	set +a
fi
export STATS_ONLY=1
export DATA_DIR="$ROOT/data"
export HOST=0.0.0.0
export PORT
exec node build/index.js
