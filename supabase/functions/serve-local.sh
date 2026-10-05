#!/usr/bin/env bash
# Runs one Edge Function (account-ops or scan-document) against the local stack for the browser tests: the stack started
# by `npm run db:start` has no Edge runtime, and a test plays the scheduler or the storage webhook by calling this process.
# Usage: serve-local.sh <function> <port>. The ports and EDGE_SHARED_SECRET come from apps/web/playwright.config.ts, the
# one place that defines them.
set -euo pipefail
cd "$(dirname "$0")/../.."
eval "$(npx supabase status -o env)"
cd supabase/functions
export SUPABASE_URL="$API_URL"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export EDGE_SHARED_SECRET="${EDGE_SHARED_SECRET:?set by playwright.config.ts}"
export DENO_SERVE_ADDRESS="tcp:127.0.0.1:${2:?the port to listen on}"
exec deno run --frozen --allow-net --allow-env "${1:?the function to serve}/index.ts"
