"use client";

import { JobModerationBadge } from "@/components/admin/job-moderation-badge";
import { ResultsPanel } from "@/components/admin/results-panel";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { SearchBox } from "@/components/admin/search-box";
import { usePagedSearch } from "@/components/admin/use-paged-search";
import { TextLink } from "@/components/forms/text-link";
import { searchJobsAction } from "@/lib/actions/admin-search";
import type { JobRow } from "@/lib/dal/admin-jobs";
import { formatShortDate } from "@/lib/i18n/format";
import { statusLabels } from "@/lib/jobs/presentation";
import { adminPath } from "@/lib/routes";
import type { JobCursor } from "@/lib/validation/admin";

export function JobModerationSearch({ lang }: { lang: string }) {
  const { state, page, search, next, previous, retry } = usePagedSearch<string, JobRow, NonNullable<JobCursor>>(searchJobsAction);

  return (
    <div className="grid gap-page">
      <SearchBox
        label="Search vacancies"
        description="Part of the title, part of the name of the organisation, or the vacancy id."
        busy={state.status === "loading"}
        onSearch={search}
      />
      <ResultsPanel
        status={state.status}
        empty="No vacancies found"
        failure="The vacancies could not be loaded"
        hasRows={state.rows.length > 0}
        page={page}
        hasNext={state.next !== null}
        onNext={next}
        onPrevious={previous}
        onRetry={retry}
      >
        <ResultsTable caption="Vacancies" columns={["Vacancy", "Organisation", "Status", "Visibility", "Created"]}>
          {state.rows.map((job) => (
            <tr key={job.id}>
              <td className={cell}>
                <TextLink href={adminPath(lang, `moderation/${job.id}`)} className="break-words">
                  {job.title}
                </TextLink>
              </td>
              <td className={`${cell} break-words`}>{job.organizationName}</td>
              <td className={cell}>{statusLabels[job.status]}</td>
              <td className={cell}>
                <JobModerationBadge state={job.moderationState} />
              </td>
              <td className={cell}>{formatShortDate(job.createdAt)}</td>
            </tr>
          ))}
        </ResultsTable>
      </ResultsPanel>
    </div>
  );
}
