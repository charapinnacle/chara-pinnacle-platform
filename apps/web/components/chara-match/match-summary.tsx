import { Notice } from "@/components/forms/notice";
import { Card } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";
import {
  MATCH_DISCLAIMER,
  matchingWorkersText,
  matchViewOf,
  partnersText,
  type MatchKind,
  type MatchSummary,
} from "@/lib/chara-match/presentation";
import { charaMatchPath } from "@/lib/routes";

type MatchSummaryProps = {
  lang: string;
  slug: string;
  runId: string;
  summary: MatchSummary;
  // The kind View matches opens: the first with matches.
  firstKind: MatchKind;
};

// "Potential workforce network" (brief section 7): the counts of one run, the workforce the partners list as a range and
// the countries it comes from, then the way to the matches. Counts only; nothing here names a worker.
export function MatchSummaryPanel({ lang, slug, runId, summary, firstKind }: MatchSummaryProps) {
  const sources = summary.sourceCountries.map(({ name }) => name).join(", ");
  return (
    <Card as="section" padding="lg" className="gap-4" aria-labelledby="match-summary-heading">
      <h2 id="match-summary-heading" className="text-h2">
        Potential workforce network
      </h2>
      <ul className="grid gap-2 text-body" data-testid="match-summary">
        <li>{matchingWorkersText(summary)}</li>
        <li>{partnersText(summary.recruitmentPartners, "recruitment")}</li>
        <li>{partnersText(summary.staffingPartners, "staffing")}</li>
        <li>
          {summary.availableWorkforce === "0"
            ? "No workforce listed by these partners for the start date yet"
            : `${summary.availableWorkforce} workers listed as available by these partners`}
        </li>
        <li>{sources ? `Available source countries: ${sources}` : "No source countries listed yet"}</li>
      </ul>
      <div>
        <LinkButton href={charaMatchPath(lang, slug, new URLSearchParams({ run: runId, view: matchViewOf[firstKind] }).toString())} size="default">
          View matches
        </LinkButton>
      </div>
      <Notice tone="info">{MATCH_DISCLAIMER}</Notice>
    </Card>
  );
}
