import { Send } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { ResponseStatusBadge } from "@/components/responses/response-status";
import { listMyResponses } from "@/lib/dal/responses";
import { formatDate } from "@/lib/i18n/format";
import { employerLabel } from "@/lib/job-orders/presentation";
import { feeText, myResponsesCountText, workersOfferedText } from "@/lib/responses/presentation";
import { jobOrdersPath, responsePath, responsesPath } from "@/lib/routes";

type MyResponseListProps = {
  lang: string;
  slug: string;
  organizationId: string;
  cursor: string | null;
  countries: Map<string, string>;
};

// One page of the responses the partner sent, newest first (FR-O2 pages, NFR-U4): the requirement as the partner knows
// it (its own title and the employer only when named, "Company not named" otherwise, NFR-S11), the status, the workers
// offered and the fee.
export async function MyResponseList({ lang, slug, organizationId, cursor, countries }: MyResponseListProps) {
  const { responses, nextCursor, cursorIgnored } = await listMyResponses(organizationId, cursor);
  if (responses.length === 0) {
    return (
      <div role="status">
        <EmptyState icon={Send} title="No responses yet" description="Respond to a job order or to an invitation, and your responses are listed here.">
          <TextLink standalone href={jobOrdersPath(lang, slug)}>
            See the open job orders
          </TextLink>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {cursorIgnored ? (
        <Notice tone="info" role="status">
          That page no longer exists, so the newest responses are shown.
        </Notice>
      ) : null}
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {myResponsesCountText(responses.length, nextCursor !== null)}
      </p>
      <ul className="divide-y border-y" aria-label="Responses">
        {responses.map((response) => (
          <li key={response.id} className="grid gap-2 py-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <h2 className="text-h3 min-w-0">
                <TextLink href={responsePath(lang, slug, response.id)} className="break-words">
                  {response.title}
                </TextLink>
              </h2>
              <ResponseStatusBadge status={response.status} view="partner" />
            </div>
            <p className="text-body break-words">{employerLabel(response.employerName)}</p>
            <p className="text-small text-muted-foreground">
              {countries.get(response.countryCode) ?? response.countryCode} · {workersOfferedText(response.capacity)} offered of{" "}
              {workersOfferedText(response.workersNeeded)} · {feeText(response.feeModel, response.feeAmount, response.feeCurrency)}
            </p>
            <p className="text-small text-muted-foreground">
              Sent <time dateTime={response.createdAt}>{formatDate(response.createdAt)}</time>
              {response.version > 1 ? (
                <>
                  {" "}
                  · Changed <time dateTime={response.updatedAt}>{formatDate(response.updatedAt)}</time>
                </>
              ) : null}
              {response.withdrawnAt ? (
                <>
                  {" "}
                  · Withdrawn <time dateTime={response.withdrawnAt}>{formatDate(response.withdrawnAt)}</time>
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {nextCursor ? (
          <TextLink standalone href={responsesPath(lang, slug, nextCursor)}>
            Show more responses
          </TextLink>
        ) : null}
        {cursor ? (
          <TextLink standalone href={responsesPath(lang, slug)}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
