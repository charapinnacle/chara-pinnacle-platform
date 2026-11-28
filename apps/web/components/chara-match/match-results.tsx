import { EmptyState } from "@/components/feedback/empty-state";
import { WorkerCard, type CardNames } from "@/components/find-workers/worker-card";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { TabLinks } from "@/components/layout/tab-links";
import {
  MATCH_DISCLAIMER,
  matchKindLabels,
  matchKinds,
  matchViewOf,
  pointsText,
  reasonText,
  type MatchKind,
  type MatchNames,
  type MatchReason,
  type MatchSummary,
} from "@/lib/chara-match/presentation";
import { listMatches, type PartnerMatch, type WorkerMatch } from "@/lib/dal/chara-match";
import { directContactTitles } from "@/lib/find-workers/presentation";
import { formatCount } from "@/lib/i18n/format";
import { charaMatchPath, partnerProfilePath } from "@/lib/routes";

type MatchResultsProps = {
  lang: string;
  slug: string;
  runId: string;
  kind: MatchKind;
  cursor: string | undefined;
  summary: MatchSummary;
  names: CardNames & MatchNames;
  // Find Workers is released: the worker matches are shown as its cards; until then only their count.
  findWorkers: boolean;
};

function countOf(kind: MatchKind, summary: MatchSummary): string {
  if (kind === "recruitment_partner") return formatCount(summary.recruitmentPartners);
  if (kind === "staffing_partner") return formatCount(summary.staffingPartners);
  return summary.matchingWorkers === null ? `<${formatCount(summary.workersFewerThan ?? 5)}` : formatCount(summary.matchingWorkers);
}

export function WhyThisMatch({ reasons, kind, names, id }: { reasons: MatchReason[]; kind: MatchKind; names: MatchNames; id: string }) {
  return (
    <div className="grid gap-1">
      <h4 id={id} className="text-body font-medium">
        Why this match
      </h4>
      <ul aria-labelledby={id} className="grid gap-0.5 text-body">
        {reasons.map((reason) => (
          <li key={reason.rule} className="flex flex-wrap justify-between gap-x-4">
            <span>{reasonText(reason, kind, names)}</span>
            <span className="text-muted-foreground">{pointsText(reason.points)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function scoreText(score: number): string {
  return `Match score ${formatCount(score)} of 100`;
}

function PartnerResult({ lang, match, kind, names }: { lang: string; match: PartnerMatch; kind: MatchKind; names: MatchNames }) {
  return (
    <Card as="li" padding="lg" className="gap-4">
      <div className="grid gap-1">
        <h3 className="text-h3">
          <TextLink href={partnerProfilePath(lang, match.slug)}>{match.displayName}</TextLink>
        </h3>
        <p className="text-small text-muted-foreground">
          {match.recruitmentCompany ? "Recruitment company" : "Staffing company"} · {scoreText(match.score)}
        </p>
      </div>
      <WhyThisMatch reasons={match.reasons} kind={kind} names={names} id={`why-${kind}-${match.id}`} />
    </Card>
  );
}

function WorkerResult({ match, names }: { match: WorkerMatch; names: CardNames & MatchNames }) {
  return (
    <li className="grid gap-3">
      <WorkerCard card={match.card} names={names} />
      <div className="grid gap-3 px-1">
        <p className="text-small text-muted-foreground">{scoreText(match.score)}</p>
        {match.directContact !== "allowed" ? (
          <Notice tone="info">
            <p className="font-semibold">{directContactTitles[match.directContact]}</p>
            <p>{match.notice}</p>
          </Notice>
        ) : null}
        <WhyThisMatch reasons={match.reasons} kind="worker" names={names} id={`why-worker-${match.id}`} />
      </div>
    </li>
  );
}

// View matches (brief section 7): one tab per kind with the count of the run, then the matches of the tab best first, each
// with why it matched. Partners link to their public profile; nothing else can be done from here.
export async function MatchResults({ lang, slug, runId, kind, cursor, summary, names, findWorkers }: MatchResultsProps) {
  const href = (view: MatchKind, after?: string) =>
    charaMatchPath(lang, slug, new URLSearchParams({ run: runId, view: matchViewOf[view], ...(after ? { cursor: after } : {}) }).toString());
  const tabs = (
    <TabLinks
      label="Matches"
      items={matchKinds.map((item) => ({
        key: item,
        href: href(item),
        label: `${matchKindLabels[item]} (${countOf(item, summary)})`,
        current: item === kind,
      }))}
    />
  );

  if (kind === "worker" && !findWorkers) {
    return (
      <section aria-labelledby="matches-heading" className="grid gap-4">
        <h2 id="matches-heading" className="text-h2">
          Matches
        </h2>
        {tabs}
        <Notice tone="info" role="status">
          The worker profiles behind this count can be viewed once worker search is available on the platform.
        </Notice>
      </section>
    );
  }

  const page = await listMatches(runId, kind, cursor);
  return (
    <section aria-labelledby="matches-heading" className="grid gap-4">
      <h2 id="matches-heading" className="text-h2">
        Matches
      </h2>
      {tabs}
      <p className="text-small text-muted-foreground">{MATCH_DISCLAIMER}</p>
      {page.state === "rate_limited" ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">Too many searches. Please wait a minute and try again.</p>
        </Notice>
      ) : page.state === "unavailable" ? (
        <Notice tone="info" role="status">
          These matches are not available for this organisation.
        </Notice>
      ) : page.matches.length === 0 ? (
        <EmptyState title={`No ${matchKindLabels[kind].toLowerCase()} matched`} description="Try another occupation, destination or recruitment type." />
      ) : (
        <ul aria-label={matchKindLabels[kind]} className="animate-stagger grid gap-6">
          {page.matches.map((match) =>
            match.kind === "worker" ? (
              <WorkerResult key={match.id} match={match} names={names} />
            ) : (
              <PartnerResult key={match.id} lang={lang} match={match} kind={kind} names={names} />
            ),
          )}
        </ul>
      )}
      {page.state === "found" ? (
        <div className="flex flex-wrap items-center gap-x-6">
          {page.nextCursor ? (
            <TextLink standalone href={href(kind, page.nextCursor)}>
              Show more matches
            </TextLink>
          ) : null}
          {cursor ? (
            <TextLink standalone href={href(kind)}>
              Back to the first page
            </TextLink>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
