import { Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ApplicantTable } from "@/components/applicants/applicant-table";
import { Board } from "@/components/applicants/board";
import { BulkSelection } from "@/components/applicants/bulk-selection";
import { BulkToolbar } from "@/components/applicants/bulk-toolbar";
import { ExportButton } from "@/components/applicants/export-button";
import { ReadOnlyButton } from "@/components/applicants/read-only-button";
import { ShortlistingUpgrade } from "@/components/applicants/shortlisting-upgrade";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { StageFilter } from "@/components/applications/stage-filter";
import { ReadOnlyPlanNotice } from "@/components/billing/read-only-plan";
import { EmptyState } from "@/components/feedback/empty-state";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import {
  APPLICANTS_PAGE_SIZE,
  getApplicantAccess,
  listApplicants,
  listBoard,
} from "@/lib/dal/applicant-list";
import { FORMER_CANDIDATE } from "@/lib/applications/presentation";
import { getJob, isSubscriptionEnded } from "@/lib/dal/hiring";
import { organizationCrumb } from "@/lib/app/navigation";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { applicantsExportPath, applicantsPath, billingPath, homePath, jobPath, jobsPath } from "@/lib/routes";
import { parseApplicantListParams } from "@/lib/validation/applicant-list";

export const metadata: Metadata = { title: "Applicants — CHARA", robots: { index: false } };

const csvNotInPlanText = "Your plan does not include the CSV export.";

const frozenText =
  "Your organization has no active paid plan. Applicant changes and the CSV export are disabled until a plan is chosen.";

// The list and the board of the applicants of one vacancy, or the list of all the vacancies of the organization. The
// address holds the whole state (vacancy, view, sort, stage, page), and every value is checked before it is used. A
// candidate is sent to their own home whatever the address; a member of another organization gets the page of an unknown
// slug.
export default async function ApplicantsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/applicants">) {
  const [{ lang, slug }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser(lang);
  if (user.accountKind === "worker") redirect(homePath(lang, user.accountKind));
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization />;

  const parsed = parseApplicantListParams(query);
  const [access, job] = await Promise.all([
    getApplicantAccess(organization.id),
    parsed.job ? getJob(organization.id, parsed.job) : null,
  ]);
  if (!access || (parsed.job && !job)) notFound();

  const board = parsed.view === "board" && parsed.job ? { jobId: parsed.job, columns: await listBoard(organization.id, parsed.job) } : null;
  const list = board ? null : await listApplicants(organization.id, parsed);
  const total = board ? board.columns.reduce((sum, column) => sum + column.total, 0) : (list?.total ?? 0);
  const empty = total === 0 && (board !== null || parsed.stage === null);
  const frozen = access.stageChangeBlocked !== null;
  const ended = frozen && (await isSubscriptionEnded(organization.id));
  const withoutStage = { ...parsed, stage: null, page: 1 };
  const kept = Object.fromEntries(new URL(applicantsPath(lang, slug, withoutStage), "http://localhost").searchParams);
  const visibleRows = board ? board.columns.flatMap((column) => column.rows) : (list?.rows ?? []);
  const shortlistable = visibleRows.some((row) => row.status === "applied" || row.status === "viewed");
  const bulkRows = frozen || empty ? null : visibleRows.map((row) => ({ id: row.id, name: row.candidateName ?? FORMER_CANDIDATE, status: row.status }));
  const lastPage = list ? Math.max(1, Math.ceil(list.total / APPLICANTS_PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-page">
      <PageHeader
        title="Applicants"
        description={
          job ? <TextLink href={jobPath(lang, slug, job.id)}>{job.title}</TextLink> : `All vacancies of ${organization.displayName}`
        }
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              ...(job ? [{ label: "Vacancies", href: jobsPath(lang, slug) }, { label: job.title, href: jobPath(lang, slug, job.id) }] : []),
              { label: "Applicants" },
            ]}
          />
        }
      />

      {frozen ? (
        <ReadOnlyPlanNotice
          ended={ended}
          billingHref={organization.role === "member" ? null : billingPath(lang, slug)}
          otherwise={frozenText}
        />
      ) : null}

      {!frozen && shortlistable && !access.shortlistingAvailable ? (
        <ShortlistingUpgrade role={organization.role} billingHref={billingPath(lang, slug)} />
      ) : null}

      {parsed.job ? (
        <nav aria-label="View" className="flex flex-wrap gap-x-6">
          {(["list", "board"] as const).map((view) => (
            <TextLink
              key={view}
              standalone
              href={applicantsPath(lang, slug, { job: parsed.job, view, stage: view === "list" ? parsed.stage : null })}
              aria-current={parsed.view === view ? "page" : undefined}
              className={parsed.view === view ? "no-underline" : undefined}
            >
              {view === "list" ? "List" : "Board"}
            </TextLink>
          ))}
        </nav>
      ) : null}

      <BulkSelection key={JSON.stringify(parsed)} rows={bulkRows}>
        {bulkRows ? <BulkToolbar slug={slug} shortlisting={access.shortlistingAvailable} noteMaxChars={access.noteMaxChars} /> : null}
        {frozen && !empty ? (
          <div>
            <ReadOnlyButton className="w-full sm:w-auto">Change stage of selected applicants</ReadOnlyButton>
          </div>
        ) : null}
        {empty ? (
          <EmptyState icon={Users} title="No applications yet" description="Applications appear here as candidates apply.">
            <TextLink standalone href={job ? jobPath(lang, slug, job.id) : jobsPath(lang, slug)}>
              {job ? "Back to the vacancy" : "Back to vacancies"}
            </TextLink>
          </EmptyState>
        ) : board ? (
          <Board
            lang={lang}
            slug={slug}
            jobId={board.jobId}
            columns={board.columns}
            frozen={frozen}
            shortlisting={access.shortlistingAvailable}
            noteMaxChars={access.noteMaxChars}
          />
        ) : list ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <StageFilter basePath={applicantsPath(lang, slug, withoutStage)} stage={parsed.stage} />
              {parsed.job ? (
                <ExportButton
                  action={applicantsExportPath(lang, slug)}
                  jobId={parsed.job}
                  stage={parsed.stage}
                  disabled={!access.csvExportAvailable}
                  hint={access.csvExportAvailable || frozen ? null : csvNotInPlanText}
                />
              ) : null}
            </div>
            {list.rows.length === 0 ? (
              <EmptyState icon={Users} title="No applicants match this filter">
                <form action={applicantsPath(lang, slug)}>
                  {Object.entries(kept).map(([name, value]) => (
                    <input key={name} type="hidden" name={name} value={value} />
                  ))}
                  <FormButton type="submit" variant="secondary" className="w-auto">
                    Clear filter
                  </FormButton>
                </form>
              </EmptyState>
            ) : (
              <ApplicantTable lang={lang} slug={slug} rows={list.rows} params={parsed} selectable={bulkRows !== null} />
            )}
            {lastPage > 1 ? (
              <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-6">
                {list.page > 1 ? (
                  <TextLink standalone rel="prev" href={applicantsPath(lang, slug, { ...parsed, page: list.page - 1 })}>
                    Previous page
                  </TextLink>
                ) : null}
                <span className="text-body text-muted-foreground">
                  Page {list.page} of {lastPage}
                </span>
                {list.page < lastPage ? (
                  <TextLink standalone rel="next" href={applicantsPath(lang, slug, { ...parsed, page: list.page + 1 })}>
                    Next page
                  </TextLink>
                ) : null}
              </nav>
            ) : null}
          </div>
        ) : null}
      </BulkSelection>
    </div>
  );
}
