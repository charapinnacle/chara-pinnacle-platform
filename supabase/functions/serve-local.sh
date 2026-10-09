#!/usr/bin/env bash
# Runs one Edge Function (account-ops, scan-document, document-url, notify, billing-checkout or billing-webhook) against the local stack for the browser tests: the
# stack started by `npm run db:start` has no Edge runtime, and a test plays the scheduler, the storage webhook or the
# Server Action by calling this process.
# Usage: serve-local.sh <function> <port>. The ports, EDGE_SHARED_SECRET and RESEND_WEBHOOK_SECRET come from
# apps/web/playwright.config.ts, the one place that defines them. notify sends to the mail catcher (the null provider);
# billing-checkout and billing-webhook use the null billing provider; BILLING_WEBHOOK_SECRET signs its deliveries.
set -euo pipefail
cd "$(dirname "$0")/../.."
eval "$(npx supabase status -o env)"
cd supabase/functions
export SUPABASE_URL="$API_URL"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_ANON_KEY="$ANON_KEY"
export EDGE_SHARED_SECRET="${EDGE_SHARED_SECRET:?set by playwright.config.ts}"
export RESEND_WEBHOOK_SECRET="${RESEND_WEBHOOK_SECRET:-}"
export EMAIL_PROVIDER=null
export BILLING_PROVIDER=null
export BILLING_WEBHOOK_SECRET="${BILLING_WEBHOOK_SECRET:-}"
export MAIL_CATCHER_URL="http://127.0.0.1:54424"
export EMAIL_FROM="CHARA <noreply@chara.test>"
export SITE_URL="http://localhost:3100"
export DENO_SERVE_ADDRESS="tcp:127.0.0.1:${2:?the port to listen on}"
exec deno run --frozen --allow-net --allow-env "${1:?the function to serve}/index.ts"
