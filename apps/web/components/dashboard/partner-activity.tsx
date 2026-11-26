import Link from "next/link";
import { Panel } from "@/components/dashboard/panel";
import { unavailableTexts, type MatchingWorkers, type PartnerRequests } from "@/lib/dashboard/connections";
import type { NetworkFigures } from "@/lib/dashboard/partner-dashboard";
import { formatCount } from "@/lib/i18n/format";
import type { SubmissionStatus } from "@/lib/submissions/presentation";
import { invitationsPath, jobOrdersPath, messagesPath, partnerSubmissionsPath, responsesPath } from "@/lib/routes";

type PartnerActivityProps = {
  lang: string;
  slug: string;
  recruitment: boolean;
  network: NetworkFigures | null;
  submissionStages: Record<SubmissionStatus, number> | null;
  requests: PartnerRequests | null;
  matchingWorkers: MatchingWorkers | null;
  findWorkersHref: string;
  // Set while messaging is on: the unread count, or where to complete the two-step check that unlocks it.
  unread: { count: Promise<number> } | { lockedHref: string } | null;
};

function Tile({ href, count, label, hint }: { href: string; count: number | null; label: string; hint?: string }) {
  return (
    <li>
      <Link
        href={href}
        className="grid h-full content-start gap-1 rounded-xl border bg-card p-4 transition-colors outline-none hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="text-figure leading-none tabular-nums">{count === null ? "–" : formatCount(count)}</span>{" "}
        <span className="text-small font-medium">{label}</span>
        {hint ? <span className="text-small text-muted-foreground"> {hint}</span> : null}
      </Link>
    </li>
  );
}

// The company's activity as one row of numbers (FR-R3 AC4, AC5, AC7, FR-R4 AC3, AC6, AC9): each number opens the page of
// the sidebar that holds the detail, so the dashboard repeats no page. A feature that is not released has no tile.
export function PartnerActivity({
  lang,
  slug,
  recruitment,
  network,
  submissionStages,
  requests,
  matchingWorkers,
  findWorkersHref,
  unread,
}: PartnerActivityProps) {
  if (!network && !submissionStages && !requests && !matchingWorkers && !unread) return null;
  const responses = network
    ? network.responsesOpen + network.responsesShortlisted + network.responsesSelected + network.responsesDeclined
    : 0;
  const submitted = submissionStages ? Object.values(submissionStages).reduce((sum, n) => sum + n, 0) : 0;
  return (
    <section aria-labelledby="activity-heading" className="grid gap-4">
      <h2 id="activity-heading" className="text-h2">
        Your activity
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {network ? (
          <>
            <Tile
              href={jobOrdersPath(lang, slug)}
              count={network.fittingJobOrders}
              label={recruitment ? "Fitting job orders" : "Workforce requests"}
              hint={
                network.matchingEmployers > 0
                  ? `From ${formatCount(network.matchingEmployers)} ${network.matchingEmployers === 1 ? "employer" : "employers"}`
                  : undefined
              }
            />
            <Tile href={invitationsPath(lang, slug)} count={network.invitationsAwaiting} label="Invitations waiting" />
            <Tile
              href={responsesPath(lang, slug)}
              count={responses}
              label="Responses"
              hint={
                network.responsesShortlisted + network.responsesSelected > 0
                  ? `${formatCount(network.responsesShortlisted)} shortlisted, ${formatCount(network.responsesSelected)} selected`
                  : undefined
              }
            />
          </>
        ) : null}
        {submissionStages ? (
          <Tile
            href={partnerSubmissionsPath(lang, slug)}
            count={submitted}
            label="Candidates submitted"
            hint={submissionStages.hired > 0 ? `${formatCount(submissionStages.hired)} hired` : undefined}
          />
        ) : null}
        {requests ? (
          <Tile href={messagesPath(lang, slug, { context: "inquiry" })} count={requests.total} label="Partner requests waiting" />
        ) : null}
        {unread && "lockedHref" in unread ? (
          <Tile href={unread.lockedHref} count={null} label="Unread messages" hint="Complete the two-step check" />
        ) : unread ? (
          <Panel promise={unread.count} errorTitle="Your unread messages could not be loaded" quiet>
            {(count) => <Tile href={messagesPath(lang, slug)} count={count} label="Unread messages" />}
          </Panel>
        ) : null}
        {matchingWorkers ? (
          <Tile
            href={findWorkersHref}
            count={matchingWorkers.kind === "count" ? matchingWorkers.count : null}
            label="Matching workers"
            hint={
              matchingWorkers.kind === "suppressed"
                ? `Fewer than ${formatCount(matchingWorkers.fewerThan)} match`
                : matchingWorkers.kind === "unavailable"
                  ? unavailableTexts[matchingWorkers.reason]
                  : undefined
            }
          />
        ) : null}
      </ul>
    </section>
  );
}
