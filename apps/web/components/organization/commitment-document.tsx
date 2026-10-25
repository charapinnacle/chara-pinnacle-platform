import { StatusBadge } from "@/components/feedback/status-badge";
import { LegalLink } from "@/components/forms/text-link";
import { formatDate } from "@/lib/i18n/format";
import { parseLegalBody } from "@/lib/public/legal-body";
import { COMMITMENT_SLUG } from "@/lib/validation/commitment";
import { displayTitle } from "@/lib/validation/consents";

type CommitmentDocumentProps = {
  document: { title: string; version: number; body: string; changeSummary: string; publishedAt: string; isDraft: boolean };
  // An earlier version was accepted: what changed is shown above the text.
  outdated: boolean;
};

// The text of the employer-pays commitment as the owner accepts it (FR-J3): its version and date, a Draft badge while
// counsel's text is not published, what changed when an earlier version was accepted, and a link to its legal page.
export function CommitmentDocument({ document, outdated }: CommitmentDocumentProps) {
  const title = displayTitle(document.title);
  return (
    <section aria-labelledby="commitment-title" className="grid gap-4 rounded-xl border bg-card p-card">
      <div className="grid gap-1.5">
        <h2 id="commitment-title" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-h3">
          {title}
          {document.isDraft ? <StatusBadge className="px-1.5 py-0 text-caption font-medium">Draft</StatusBadge> : null}
        </h2>
        <p className="text-small text-muted-foreground">
          Version {document.version} · {formatDate(document.publishedAt)}
        </p>
        {outdated ? (
          <p className="text-small leading-relaxed">
            <span className="font-medium">What changed:</span> {document.changeSummary}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 text-small leading-relaxed">
        {parseLegalBody(document.body).map((block, index) =>
          block.kind === "heading" ? (
            <h3 key={index} className="text-body font-semibold">
              {block.text}
            </h3>
          ) : (
            <p key={index} className="whitespace-pre-line wrap-anywhere">
              {block.text}
            </p>
          ),
        )}
      </div>
      <LegalLink slug={COMMITMENT_SLUG} newTabLabel={`of the ${title} (opens in a new tab)`} standalone className="-mb-1.5">
        Read the full text
      </LegalLink>
    </section>
  );
}
