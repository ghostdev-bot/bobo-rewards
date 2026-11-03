#!/bin/bash
# Rebuild leaderboard + burn + overview (vaults) + forecast snapshots (incremental) and redeploy boborewards.surge.sh. Box-only; reads secrets from /home/box/secrets.
set -euo pipefail
cd /workspace/boborewards
node scripts/build-leaderboard.mjs 2>>.cache/refresh.log
node scripts/build-burns.mjs 2>>.cache/refresh.log
# overview lifetime totals (vaults.json), incremental ~40 Helius credits; non-fatal so the previous snapshot stays
node scripts/build-vaults.mjs 2>>.cache/refresh.log || echo "build-vaults failed $(date -u +%FT%TZ)" >>.cache/refresh.log
# forecast inputs; non-fatal so a hiccup here never blocks the leaderboard/burn deploy (the previous forecast.json stays)
node scripts/build-forecast.mjs >/dev/null 2>>.cache/refresh.log || echo "build-forecast failed $(date -u +%FT%TZ)" >>.cache/refresh.log
SURGE_LOGIN="$(jq -r .email /home/box/secrets/surge.json)" SURGE_TOKEN="$(jq -r .token /home/box/secrets/surge.json)" npx --yes surge@0.53.0 /workspace/boborewards/site boborewards.surge.sh >>.cache/refresh.log 2>&1
echo "refreshed + deployed $(date -u +%FT%TZ)"
