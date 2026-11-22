import { Handshake } from "lucide-react";
import { FocusOnMount } from "@/components/admin/focus-on-mount";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { partnerTypeLabels } from "@/components/forms/account-kind-options";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { listPartnerReviews } from "@/lib/dal/admin-partner-reviews";
import { getCountries } from "@/lib/dal/reference";
import { formatDateTime, formatRelative } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import { identifierKindLabels } from "@/lib/validation/organization";
import { queueCursorParam, reviewOverdue, type QueueCursor } from "@/lib/validation/partner-review";

const FIRST_ROW_ID = "partner-review-first";

type PartnerReviewQueueProps = { lang: string; after: QueueCursor | null; decided: boolean };

// The partners waiting for a decision in the order the database gives, oldest submission first (FR-J4 AC1), with how long
// each has waited and whether its review target has passed (decision 7.2). After a decision the reviewer lands here with
// focus on the next partner.
export async function PartnerReviewQueue({ lang, after, decided }: PartnerReviewQueueProps) {
  const [page, countries] = await Promise.all([listPartnerReviews(after), getCountries()]);
  const countryName = new Map(countries.map(({ code, name }) => [code, name]));
  const now = new Date();

  return (
    <div className="grid gap-4">
      {decided ? (
        <Notice tone="info" role="status">
          The decision is saved.{page.rows.length > 0 ? " The next partner waiting is first in the list." : ""}
        </Notice>
      ) : null}
      {page.rows.length === 0 ? (
        <EmptyState icon={Handshake} title="No partners waiting for review" description="Submitted companies appear here, oldest first." />
      ) : (
        <ResultsTable caption="Partners to review" columns={["Company", "Type", "Country", "Identifier", "Website", "Waiting", "Review target"]}>
          {page.rows.map((row, index) => {
            const overdue = reviewOverdue(row.dueAt, now);
            return (
              <tr key={row.id}>
                <td className={`${cell} break-words`}>
                  <TextLink id={index === 0 ? FIRST_ROW_ID : undefined} href={adminPath(lang, `partners/${row.id}`)}>
                    {row.legalName}
                  </TextLink>
                  <span className="block text-small text-muted-foreground">{row.displayName}</span>
                  {row.status === "re_review" ? (
                    <span className="block text-small text-muted-foreground">Re-review after a change of legal details</span>
                  ) : null}
                  {row.sameIdentifier ? (
                    <StatusBadge status="warning" className="mt-1">
                      Same identifier as another company
                    </StatusBadge>
                  ) : null}
                </td>
                <td className={cell}>{partnerTypeLabels[row.type]}</td>
                <td className={cell}>{countryName.get(row.country) ?? row.country}</td>
                <td className={`${cell} wrap-break-word`}>
                  <span className="font-mono">{row.identifier}</span>
                  {row.identifierKind ? (
                    <span className="block text-small text-muted-foreground">{identifierKindLabels[row.identifierKind]}</span>
                  ) : null}
                </td>
                <td className={`${cell} wrap-break-word`}>{row.website ?? "None given"}</td>
                <td className={cell}>
                  <time dateTime={row.submittedAt} title={formatDateTime(row.submittedAt)}>
                    {formatRelative(row.submittedAt, now)}
                  </time>
                </td>
                <td className={cell}>
                  <StatusBadge status={overdue ? "danger" : "neutral"}>{overdue ? "Overdue" : "Due"}</StatusBadge>
                  <time dateTime={row.dueAt} className="block text-small text-muted-foreground">
                    {formatDateTime(row.dueAt)}
                  </time>
                </td>
              </tr>
            );
          })}
        </ResultsTable>
      )}
      {decided ? <FocusOnMount targetId={FIRST_ROW_ID} /> : null}
      {page.next ? (
        <TextLink standalone href={`${adminPath(lang, "partners")}?after=${encodeURIComponent(queueCursorParam(page.next))}`}>
          Show more
        </TextLink>
      ) : null}
    </div>
  );
}
