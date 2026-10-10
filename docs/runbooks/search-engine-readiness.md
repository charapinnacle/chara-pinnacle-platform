# Runbook: search engine readiness

FR-H5, design point D75 (OPEN_QUESTIONS.md). The SOP is "Search Engine Readiness E2E SOP" (owner Marketing / Platform, reviewed quarterly). It names one KPI, the share of open vacancies that are indexed, one risk, indexing of private pages, and two controls, the robots rules and the tests.

## 1. What the application produces

- Page metadata: the title, description, canonical address (absolute, from `NEXT_PUBLIC_SITE_URL`, never a query string) and Open Graph title and description of the eight static pages (`lib/seo/pages.ts`), the legal pages and each vacancy (`lib/seo/metadata.ts`). A vacancy title is `<title> - <employer> | CHARA` cut to 60 characters; its description is the first 155 characters of its text.
- `app/sitemap.ts`: the eight pages, the ten legal pages that have a published version, and every open, visible, undeleted vacancy with the date of its last change. It reads the database through `list_sitemap_jobs` and a select on `legal_documents` at every request that reaches the server, and the response carries `Cache-Control: public, s-maxage=300, stale-while-revalidate=300` (`next.config.ts`), so the CDN in front of the web host serves repeat requests and a vacancy that opens or leaves is listed or gone within five minutes. Without a CDN every request costs one query per 5000 vacancies. One file, up to 50,000 URLs.
- `app/robots.ts`: allows `/`, disallows the private areas of `lib/seo/private-routes.ts`, names `<NEXT_PUBLIC_SITE_URL>/sitemap.xml`.
- `proxy.ts`: `X-Robots-Tag: noindex, nofollow` on every response for a private path, redirects included. The vacancy that is not available and the preview carry a robots tag of their own.
- `lib/jobs/job-posting.ts`: the JobPosting markup of a vacancy page (title, description, `datePosted` (the UTC date the vacancy was created), employer name and website, place, employment type, salary). Nothing else is copied into it and `<` is escaped.

## 2. Keeping private pages out (risk and control)

The private areas are one list, `privateSegments` in `lib/seo/private-routes.ts`. A page behind a login, a sign-in page or a page that tells a signed-in person no must have its first segment there. `seo-private-routes.test.ts` reads the folders of the route groups `(app)`, `(auth)` and `(admin)` and fails when one is missing, so adding a private page without the entry fails the unit tests. The browser tests check the header on every private path for a visitor, a candidate and a company owner, and the absence of any noindex on the public pages.

`NEXT_PUBLIC_SITE_URL` must be the public https address of each environment. The same rules apply to every environment; a staging site is kept out of search engines by the access control of its host, not by this file.

## 3. KPI: indexed vacancies (%)

- Denominator, the vacancies that are offered to the crawlers: `select count(*) from public.jobs where status = 'open' and deleted_at is null and moderation_state = 'visible';` (the number of vacancy entries of `/sitemap.xml`).
- Numerator, the vacancies that Google has indexed: in Search Console, Indexing, Pages, filter the URLs that contain `/en/jobs/`, and read the number of indexed pages.
- Record both and the percentage once a month in the review notes of the owner. Indexing is Google's decision and takes days; a value below the usual one is a reason to look at section 4, not an error of the platform.

## 4. Monthly review (SOP step "Monitor")

1. Search Console, Pages: open every error and every "excluded" reason that is new since last month. Log each error with an owner and a fix date.
2. Sitemaps: the status of `/sitemap.xml` is "Success" and the discovered URLs match the denominator of section 3.
3. Record the KPI of section 3.

## 5. Before a release

Check one vacancy of each employment type, with and without a salary, in Google's Rich Results Test (the URL, or the HTML of the page): it reports a valid JobPosting without errors. This is a manual check; no test calls a Google service.

## 6. Quarterly review (SOP frequency)

The employment type mapping (`seasonal` to `TEMPORARY`, `contract` to `CONTRACTOR`) is still right; the private list of section 2 still matches the app; the KPI trend of the quarter.
