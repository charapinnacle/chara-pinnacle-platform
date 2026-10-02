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

## Contributing

Branch from `main` as `feat/…`, `fix/…` or `chore/…` and open a pull request; CI must pass. Commits and PRs reference the requirement (`FR-xx`, `NFR-xx`) and work package (`WPn`) they implement.
