# ADR-0001: Express and Prisma backend

- Status: Superseded by [ADR-0002](0002-supabase-backend.md)
- Date: 2026-10-02

## Context

The first design for CHARA was a monorepo with a Next.js web application and a custom API server built on Express 5 with Prisma 6 as the ORM and schema tool.

## Decision

Not adopted. The project owner chose Supabase as the entire backend before any backend code was written (ADR-0002).

## Consequences

- The API server was never built in this repository. There is no `apps/api`, no Prisma schema and no `docker-compose.yml` to remove or migrate from.
- The monorepo layout (npm workspaces, `apps/*` and `packages/*`) is the only part of the first design that remains.
- This record exists so that the numbering matches the Phase 1 design documents, which refer to ADR-0001 to ADR-0005.
