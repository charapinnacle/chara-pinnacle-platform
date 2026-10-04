#!/usr/bin/env bash
# Runs account-ops against the local stack on port 54430 for the browser tests: the stack started by `npm run db:start`
# has no Edge runtime, and a test plays the scheduler by calling this process.
set -euo pipefail
cd "$(dirname "$0")/../.."
eval "$(npx supabase status -o env)"
cd supabase/functions
export SUPABASE_URL="$API_URL"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export EDGE_SHARED_SECRET="${EDGE_SHARED_SECRET:-local-scheduler-secret}"
export DENO_SERVE_ADDRESS="tcp:127.0.0.1:54430"
exec deno run --frozen --allow-net --allow-env account-ops/index.ts
