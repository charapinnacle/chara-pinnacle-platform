import { LinkButton } from "@/components/layout/link-button";
import { responseCountText } from "@/lib/responses/presentation";
import { requirementResponsesPath } from "@/lib/routes";

type RequirementResponsesProps = { lang: string; slug: string; requirementId: string; count: number | null; updated: number };

// The way from a published requirement to the partners' responses (FR-O2), with how many there are and how many changed
// since they were opened; a failed read leaves the count out, not the link.
export function RequirementResponses({ lang, slug, requirementId, count, updated }: RequirementResponsesProps) {
  return (
    <section aria-labelledby="requirement-responses-heading" className="grid gap-3">
      <h2 id="requirement-responses-heading" className="text-h2">
        Responses
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        Read each partner&apos;s proposal, its documents and its history.
        {count !== null ? ` ${responseCountText(count)} so far.` : null}
        {updated > 0 ? ` ${responseCountText(updated)} changed since you last opened ${updated === 1 ? "it" : "them"}.` : null}
      </p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={requirementResponsesPath(lang, slug, requirementId)} variant="secondary" size="default">
          See responses
        </LinkButton>
      </div>
    </section>
  );
}
