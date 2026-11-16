import { UserRoundCheck } from "lucide-react";
import { StageFilter } from "@/components/applications/stage-filter";
import { EmptyState } from "@/components/feedback/empty-state";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { SubmissionPipeline } from "@/components/submissions/submission-pipeline";
import { SUBMISSIONS_PAGE_SIZE, listEmployerSubmissions, listSubmissionBoard } from "@/lib/dal/submission-pipeline";
import { applicantsPath, requirementResponsesPath, submissionPipelinePath } from "@/lib/routes";
import { employerSubmissionLabels, pipelineSubmissionStages } from "@/lib/submissions/presentation";
import type { SubmissionListParams } from "@/lib/validation/submission-pipeline";

type SubmissionPipelineViewProps = {
  lang: string;
  slug: string;
  organizationId: string;
  params: SubmissionListParams;
  frozen: boolean;
  shortlisting: boolean;
  noteMaxChars: number;
};

const stageOptions = pipelineSubmissionStages.map((value) => ({ value, label: employerSubmissionLabels[value] }));

const CANDIDATE = "Candidate";

// The submitted candidates on the applicants page (FR-O5 AC1, AC12): of one requirement as a list or a board, or of every
// requirement as a list, filtered by stage. A requirement without any submitted candidate says so and leads to the
// partners it selected; a filter without a match offers to clear it.
export async function SubmissionPipelineView({
  lang,
  slug,
  organizationId,
  params,
  frozen,
  shortlisting,
  noteMaxChars,
}: SubmissionPipelineViewProps) {
  const board = params.view === "board" && params.requirement ? await listSubmissionBoard(organizationId, params.requirement) : null;
  const list = board ? null : await listEmployerSubmissions(organizationId, params);
  const rows = (board ? board.flatMap((column) => column.rows) : (list?.rows ?? [])).map((row) => ({
    id: row.id,
    candidateName: row.candidateName ?? CANDIDATE,
    partnerName: row.partnerName,
    requirementTitle: params.requirement ? null : row.requirementTitle,
    status: row.status,
    approvedAt: row.approvedAt,
    stageChangedAt: row.stageChangedAt,
  }));
  const total = board ? rows.length : (list?.total ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / SUBMISSIONS_PAGE_SIZE));
  const withoutStage = { ...params, stage: null, page: 1 };
  // Clearing a stage keeps the requirement or the source; clearing the source alone goes back to the direct applicants.
  const [clearPath, clearQuery = ""] = (params.stage ? submissionPipelinePath(lang, slug, withoutStage) : applicantsPath(lang, slug)).split("?");

  if (total === 0 && params.requirement && params.stage === null) {
    return (
      <EmptyState
        icon={UserRoundCheck}
        title="No candidates have been submitted yet"
        description="Candidates proposed by the partners you selected appear here once each candidate approves the submission."
      >
        <TextLink standalone href={requirementResponsesPath(lang, slug, params.requirement)}>
          See the partners selected for this requirement
        </TextLink>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4">
      {board ? null : <StageFilter basePath={submissionPipelinePath(lang, slug, withoutStage)} stage={params.stage} options={stageOptions} />}
      {total === 0 ? (
        <EmptyState icon={UserRoundCheck} title="No candidates match this filter">
          <form action={clearPath}>
            {[...new URLSearchParams(clearQuery)].map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <FormButton type="submit" variant="secondary" className="w-auto">
              Clear filter
            </FormButton>
          </form>
        </EmptyState>
      ) : (
        <SubmissionPipeline
          key={JSON.stringify(params)}
          lang={lang}
          slug={slug}
          view={board ? "board" : "list"}
          rows={rows}
          frozen={frozen}
          shortlisting={shortlisting}
          noteMaxChars={noteMaxChars}
        />
      )}
      {list && lastPage > 1 ? (
        <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-6">
          {list.page > 1 ? (
            <TextLink standalone rel="prev" href={submissionPipelinePath(lang, slug, { ...params, page: list.page - 1 })}>
              Previous page
            </TextLink>
          ) : null}
          <span className="text-body text-muted-foreground">
            Page {list.page} of {lastPage}
          </span>
          {list.page < lastPage ? (
            <TextLink standalone rel="next" href={submissionPipelinePath(lang, slug, { ...params, page: list.page + 1 })}>
              Next page
            </TextLink>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
