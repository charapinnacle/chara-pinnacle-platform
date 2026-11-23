import { TextLink } from "@/components/forms/text-link";
import { DecisionControls } from "@/components/responses/decision-controls";
import { ResponseDocumentList } from "@/components/responses/response-document-list";
import { ResponseStatusBadge } from "@/components/responses/response-status";
import type { ComparedResponse, ResponseDocument, ResponseTerms } from "@/lib/dal/responses";
import { formatDate } from "@/lib/i18n/format";
import { employerStatusLabels, feeModelLabels, feeText, termsLines, workersOfferedText } from "@/lib/responses/presentation";
import { partnerProfileForPath, requirementResponsePath } from "@/lib/routes";

type ResponseComparisonProps = {
  lang: string;
  slug: string;
  requirementId: string;
  responses: ComparedResponse[];
  documents: ResponseDocument[] | null;
  countryNames: Map<string, string>;
  canDecide: boolean;
  // The skills and fee terms beside each response, by response id, and the language names they may name.
  terms: ReadonlyMap<string, ResponseTerms>;
  languageNames: ReadonlyMap<string, string>;
};

const columnId = (id: string) => `response-column-${id}`;

const COMPARISON_NAME = "Responses compared side by side";

type Row = { label: string; cell: (response: ComparedResponse) => React.ReactNode };

// The responses that are not withdrawn side by side (FR-O3 step Compare, AC1, AC2): one column per partner, headed by its
// name with a link to its profile, and the same rows in the same order for each, so every partner is compared on equal
// terms. The table scrolls inside its own container with the row headers held at the left, so a small screen never
// scrolls the page sideways; the container is positioned so the visually hidden text in the cells is clipped by it too
// instead of stretching the page. Owners and admins decide in the last row; members only compare. No licence detail.
export function ResponseComparison({
  lang,
  slug,
  requirementId,
  responses,
  documents,
  countryNames,
  canDecide,
  terms,
  languageNames,
}: ResponseComparisonProps) {
  // Every partner on the same rows, "Not stated" where it added nothing.
  const termsRows: Row[] = termsLines(undefined, (code) => code, true).map(([label], index) => ({
    label,
    cell: (response) => termsLines(terms.get(response.id), (code) => languageNames.get(code) ?? code, true)[index][1],
  }));
  const rows: Row[] = [
    { label: "Status", cell: (response) => <ResponseStatusBadge status={response.status} view="employer" updatedUnseen={response.updatedUnseen} /> },
    { label: "Workers offered", cell: (response) => workersOfferedText(response.capacity) },
    { label: "Earliest start", cell: (response) => <time dateTime={response.availableFrom}>{formatDate(response.availableFrom)}</time> },
    { label: "Fee model", cell: (response) => feeModelLabels[response.feeModel] },
    { label: "Fee", cell: (response) => feeText(response.feeModel, response.feeAmount, response.feeCurrency) },
    ...termsRows,
    {
      label: "Relevant experience",
      cell: (response) => <p className="max-w-[40ch] break-words whitespace-pre-line">{response.experienceNote}</p>,
    },
    {
      label: "Timeline",
      cell: (response) => <p className="max-w-[40ch] break-words whitespace-pre-line">{response.timelineNote ?? "Not given"}</p>,
    },
    {
      label: "Served countries",
      cell: (response) =>
        response.servedCountries.length > 0
          ? response.servedCountries.map((code) => countryNames.get(code) ?? code).join(", ")
          : "Not given",
    },
    { label: "Response date", cell: (response) => <time dateTime={response.createdAt}>{formatDate(response.createdAt)}</time> },
    {
      label: "Supporting documents",
      cell: (response) => {
        if (documents === null) return "Could not be loaded";
        return <ResponseDocumentList slug={slug} documents={documents.filter((document) => document.responseId === response.id)} />;
      },
    },
    {
      label: "Note to the partner",
      cell: (response) => (response.decisionNote ? <p className="max-w-[40ch] break-words whitespace-pre-line">{response.decisionNote}</p> : "None"),
    },
  ];
  if (canDecide) {
    rows.push({
      label: "Decision",
      cell: (response) =>
        response.status === "selected" || response.status === "declined" ? (
          employerStatusLabels[response.status]
        ) : (
          <DecisionControls
            slug={slug}
            requirementId={requirementId}
            responseId={response.id}
            partnerName={response.partnerName}
            status={response.status}
            submissionsAllowed={response.submissionsAllowed}
            focusTargetId={columnId(response.id)}
          />
        ),
    });
  }

  return (
    <div className="relative overflow-x-auto rounded-xl border" role="region" aria-label={COMPARISON_NAME} tabIndex={0}>
      <table className="w-full border-collapse text-start text-body">
        <caption className="sr-only">{COMPARISON_NAME}</caption>
        <thead>
          <tr>
            <td className="sticky start-0 z-10 min-w-36 border-b bg-card p-3" />
            {responses.map((response) => (
              <th key={response.id} id={columnId(response.id)} tabIndex={-1} scope="col" className="min-w-60 border-b border-s bg-card p-3 align-top">
                <span className="grid gap-1">
                  {response.partnerSlug ? (
                    <TextLink href={partnerProfileForPath(lang, response.partnerSlug, slug)}>{response.partnerName}</TextLink>
                  ) : (
                    response.partnerName
                  )}
                  <TextLink href={requirementResponsePath(lang, slug, requirementId, response.id)} className="text-small">
                    Read the response<span className="sr-only"> of {response.partnerName}</span>
                  </TextLink>
                  <span className="text-small font-normal text-muted-foreground">
                    {response.invitationId ? "Invited partner" : "From the job order marketplace"}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="sticky start-0 z-10 border-b bg-card p-3 align-top text-small font-medium text-muted-foreground">
                {row.label}
              </th>
              {responses.map((response) => (
                <td key={response.id} className="border-b border-s bg-card p-3 align-top">
                  {row.cell(response)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
