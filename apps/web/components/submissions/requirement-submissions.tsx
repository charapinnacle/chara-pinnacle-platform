import { LinkButton } from "@/components/layout/link-button";
import { formatCount } from "@/lib/i18n/format";
import { submissionPipelinePath } from "@/lib/routes";
import { submittedByLabel } from "@/lib/submissions/presentation";

type RequirementSubmissionsProps = {
  lang: string;
  slug: string;
  requirementId: string;
  // The partners of the submitted candidates who have not withdrawn, one entry per candidate; null when the read failed.
  partners: string[] | null;
};

// The way from a requirement to its submitted candidates in the pipeline (FR-O5 AC1): how many there are and the
// partners that submitted them, labelled as in the pipeline; a failed read leaves the count out, not the link.
export function RequirementSubmissions({ lang, slug, requirementId, partners }: RequirementSubmissionsProps) {
  const counts = new Map<string, number>();
  for (const partner of partners ?? []) counts.set(partner, (counts.get(partner) ?? 0) + 1);
  return (
    <section aria-labelledby="requirement-submissions-heading" className="grid gap-3">
      <h2 id="requirement-submissions-heading" className="text-h2">
        Submitted candidates
      </h2>
      {partners !== null ? (
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          {partners.length === 0
            ? "No candidates have been submitted yet. A selected partner's candidates appear here once they approve."
            : `${formatCount(partners.length)} ${partners.length === 1 ? "candidate" : "candidates"} submitted by partners.`}
        </p>
      ) : null}
      {counts.size > 0 ? (
        <ul className="grid gap-1 text-body">
          {[...counts].map(([partner, count]) => (
            <li key={partner} className="wrap-anywhere">
              {submittedByLabel(partner)}: {formatCount(count)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <LinkButton href={submissionPipelinePath(lang, slug, { requirement: requirementId })} variant="secondary" size="default">
          See submitted candidates
        </LinkButton>
      </div>
    </section>
  );
}
