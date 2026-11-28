import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CharaMatchForm } from "@/components/chara-match/match-form";
import { MatchResults } from "@/components/chara-match/match-results";
import { MatchSummaryPanel } from "@/components/chara-match/match-summary";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { matchViews, type MatchKind, type MatchSummary } from "@/lib/chara-match/presentation";
import { getMatchRun } from "@/lib/dal/chara-match";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser, requireOrgRole } from "@/lib/dal/session";
import { billingPath } from "@/lib/routes";
import { charaMatchPrefill } from "@/lib/validation/chara-match";

export const metadata: Metadata = { title: "CHARA Match", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR = /^\d{1,3}\|[0-9a-f-]{36}$/;

const toRecord = (items: readonly { code: string; name: string }[]) => Object.fromEntries(items.map(({ code, name }) => [code, name]));

// The first kind with matches, workers last while their cards cannot be shown.
function firstKind(summary: MatchSummary, findWorkers: boolean): MatchKind {
  const workers = summary.matchingWorkers !== 0 && findWorkers;
  if (workers) return "worker";
  if (summary.recruitmentPartners > 0) return "recruitment_partner";
  if (summary.staffingPartners > 0) return "staffing_partner";
  return findWorkers ? "worker" : "recruitment_partner";
}

// CHARA Match of an employer (ARCHITECTURE.md section 9.3, brief section 7), while it and the partner directories are
// released: the form, then at the address of a run (?run=) its "Potential workforce network", and with ?view= its matches
// of one kind with why each matched. Every member may run it; chara_match decides the plan, the limit and the matches.
// A link may prefill the form (a workforce requirement's Find matches); a run shown again fills it with what was asked.
export default async function CharaMatchPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/match">) {
  const [{ lang, slug }, rawParams] = await Promise.all([params, searchParams]);
  const [released, directories, findWorkers] = await Promise.all([
    isReleased("release_chara_match"),
    isReleased("release_partner_directories"),
    isReleased("release_find_workers"),
  ]);
  if (!released || !directories || !(await getCurrentUser())) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization title="CHARA Match" subject="matches" />;

  const runParam = typeof rawParams.run === "string" && UUID.test(rawParams.run) ? rawParams.run : null;
  const view = typeof rawParams.view === "string" ? matchViews[rawParams.view] : undefined;
  const cursor = typeof rawParams.cursor === "string" && CURSOR.test(rawParams.cursor) ? rawParams.cursor : undefined;
  const [run, occupations, industries, countries, languages] = await Promise.all([
    runParam ? getMatchRun(organization.id, runParam) : null,
    getOccupations(),
    getIndustries(),
    getCountries(),
    findWorkers ? getLanguages() : [],
  ]);
  const names = {
    countries: toRecord(countries),
    industries: toRecord(industries),
    languages: toRecord(languages),
    occupations: Object.fromEntries(occupations.map(({ code, label }) => [code, label])),
  };

  return (
    <div className="grid w-full gap-section">
      <PageHeader title="CHARA Match" breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "CHARA Match" }]} />}>
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          Tell us what you need and see the workers and partner companies on the platform that fit it, and why. Matching uses
          the structured data of profiles and listings with documented rules, the same for every company.
        </p>
      </PageHeader>
      {runParam && !run ? (
        <Notice tone="info" role="status">
          This match is no longer available. Matches are kept for 90 days; run it again below.
        </Notice>
      ) : null}
      <CharaMatchForm
        key={run?.id ?? "new"}
        slug={slug}
        defaultValues={run?.inputs ?? charaMatchPrefill(rawParams)}
        occupations={occupations}
        industries={industries}
        countries={countries}
        billingHref={organization.role !== "member" ? billingPath(lang, slug) : null}
      />
      {run ? (
        <>
          <MatchSummaryPanel lang={lang} slug={slug} runId={run.id} summary={run.summary} firstKind={firstKind(run.summary, findWorkers)} />
          {view ? (
            <Suspense key={`${view}-${cursor ?? ""}`} fallback={<LoadingSkeleton rows={4} />}>
              <MatchResults
                lang={lang}
                slug={slug}
                runId={run.id}
                kind={view}
                cursor={cursor}
                summary={run.summary}
                names={names}
                findWorkers={findWorkers}
              />
            </Suspense>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
