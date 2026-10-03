# Chara Pinnacle Platform

CHARA is a global workforce network connecting workers, employers, recruitment companies and staffing companies.

- `apps/web` — Next.js 16 (App Router, TypeScript, Tailwind 4)
- Backend — Supabase (Auth, Postgres with Row Level Security, Storage, Edge Functions); added in `supabase/`

## Develop

Requires Node 22 or newer (CI uses the version in `.nvmrc`).

```bash
npm ci
npm run dev        # http://localhost:3100
```

```bash
npm run lint
npm run typecheck
npm run build
```

## Database

The local Supabase stack runs in Docker. Use the npm scripts (or `npx supabase`), not a globally installed `supabase`; the CLI version is pinned in `package.json`. Without Docker, open a draft pull request and use the CI `db` job.

```bash
npm run db:start   # API http://127.0.0.1:54421, Studio :54423, mail catcher :54424
npm run db:reset   # re-apply migrations and seeds
npm run db:test    # pgTAP tests in supabase/tests/database
npm run db:stop
```

## End-to-end tests

Playwright (Chromium) builds and starts the web app on port 3100 and runs against the local stack, which must be running (`npm run db:start`). Install the browser once with `npx playwright install chromium` in `apps/web`.

```bash
npm run e2e
```

Helpers (Mailpit client, TOTP codes, test-user factory) are in `apps/web/tests/e2e/support`. The factory reads the local Auth admin key from `E2E_AUTH_ADMIN_KEY`; when it is not exported, `playwright.config.ts` reads it from `npx supabase status`.

## Contributing

Branch from `main` as `feat/…`, `fix/…` or `chore/…` and open a pull request; CI must pass. Commits and PRs reference the requirement (`FR-xx`, `NFR-xx`) and work package (`WPn`) they implement.
