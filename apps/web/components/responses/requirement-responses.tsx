import { LinkButton } from "@/components/layout/link-button";
import { responseCountText } from "@/lib/responses/presentation";
import { requirementResponsesComparePath, requirementResponsesPath } from "@/lib/routes";

type RequirementResponsesProps = {
  lang: string;
  slug: string;
  requirementId: string;
  count: number | null;
  updated: number;
  selected: string[];
  comparable: boolean;
};

// The way from a published requirement to the partners' responses (FR-O2), with how many there are and how many changed
// since they were opened, and the partners selected for it (FR-O3 step Record); a failed read leaves the count out, not
// the links. Compare responses is offered while a response is not withdrawn.
export function RequirementResponses({ lang, slug, requirementId, count, updated, selected, comparable }: RequirementResponsesProps) {
  return (
    <section aria-labelledby="requirement-responses-heading" className="grid gap-3">
      <h2 id="requirement-responses-heading" className="text-h2">
        Responses
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        Read each partner&apos;s proposal, its documents and its history, and compare them side by side.
        {count !== null ? ` ${responseCountText(count)} so far.` : null}
        {updated > 0 ? ` ${responseCountText(updated)} changed since you last opened ${updated === 1 ? "it" : "them"}.` : null}
      </p>
      {selected.length > 0 ? (
        <p className="max-w-[65ch] text-body leading-relaxed">
          Selected {selected.length === 1 ? "partner" : "partners"}: {selected.join(", ")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <LinkButton href={requirementResponsesPath(lang, slug, requirementId)} variant="secondary" size="default">
          See responses
        </LinkButton>
        {comparable ? (
          <LinkButton href={requirementResponsesComparePath(lang, slug, requirementId)} variant="secondary" size="default">
            Compare responses
          </LinkButton>
        ) : null}
      </div>
    </section>
  );
}
