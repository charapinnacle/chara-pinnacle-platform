# ADR-0004: Strict nonce CSP with dynamic rendering; Postgres is the cache

- Status: Accepted
- Date: 2026-10-02

## Context

The documented `@supabase/ssr` pattern keeps auth cookies readable by the browser client, which is used for Realtime subscriptions. That is acceptable only if script injection is blocked reliably, so the Content Security Policy must not allow inline or unlisted scripts.

A nonce-based policy needs a fresh nonce on every response. In Next.js 16 this means the HTML cannot be prerendered or cached: pages must be rendered per request. Hash-based and SRI-based policies, which would allow static HTML, are still experimental in Next.js. Web hosting is undecided, so no CDN-specific caching can be assumed either.

## Decision

1. `apps/web/proxy.ts` generates a nonce per request and sets a `Content-Security-Policy` with that nonce and `'strict-dynamic'` on the request and response headers. Scripts are never allowed through `'unsafe-inline'`.
2. All routes render dynamically. `cacheComponents` stays off; there is no static prerendering or ISR of HTML.
3. Caching is done in the database: aggregate and statistics queries read Postgres materialized views (schema `stats`) refreshed on a schedule. React `cache()` deduplicates reads within a request. Static assets and images remain cacheable by a CDN.
4. Session and data-access code follows the Next.js Cache Components authentication guidance (session reads behind `<Suspense>`, layouts do not await the session at top level), so that enabling Cache Components later is a configuration and CSP change, not a rewrite.
5. The proxy matcher must cover all application routes. Server Actions are POSTs to the page route, so excluding a path would silently remove its CSP and session refresh.

Revisit this decision when either holds:

- hosting is chosen and public pages need CDN-cached HTML; or
- Next.js SRI or hash-based CSP leaves experimental status.

## Consequences

Benefits:

- Injected scripts without the per-request nonce do not execute, including on pages that handle sessions and documents.
- One rendering mode for every route; no cache invalidation logic in the web tier.

Costs:

- No ISR, static generation or cached HTML. Every page view, including public marketing and legal pages, is rendered on the server, which raises time to first byte and server load compared with static pages.
- The proxy runs on every matched request.
- Any third-party script must receive the nonce; scripts that inject inline code without it are blocked.
- Data served from materialized views is as stale as the refresh interval.
- The CSP is built in `apps/web/lib/csp.ts` and applied by `apps/web/proxy.ts`; `apps/web/app/[lang]/layout.tsx` calls `connection()` so that no route is prerendered.
