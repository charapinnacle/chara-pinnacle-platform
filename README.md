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

## Contributing

Branch from `main` as `feat/…`, `fix/…` or `chore/…` and open a pull request; CI must pass. Commits and PRs reference the requirement (`FR-xx`, `NFR-xx`) and work package (`WPn`) they implement.
