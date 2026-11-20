import { BlockCard, Figure } from "@/components/dashboard/block-card";
import { Panel } from "@/components/dashboard/panel";
import { TextLink } from "@/components/forms/text-link";
import {
  outcomeText,
  submissionStageLines,
  type NetworkFigures,
  type SubmissionOutcome,
} from "@/lib/dashboard/partner-dashboard";
import { getSubmissionOutcomes } from "@/lib/dal/partner-dashboard";
import { formatCount } from "@/lib/i18n/format";
import type { SubmissionStatus } from "@/lib/submissions/presentation";
import {
  findEmployersPath,
  invitationsPath,
  jobOrdersPath,
  partnerSubmissionsPath,
  requirementSubmissionsPath,
  responsesPath,
  workforceProfilePath,
} from "@/lib/routes";
import type { PartnerType } from "@/lib/validation/sign-up";

type Place = { lang: string; slug: string };

// Fitting job orders of a recruitment company, workforce requests of a staffing company (FR-R3 AC4, AC7, FR-R4 AC3, AC7,
// AC9): the count, the employers behind the marketplace ones (a number, never a name) and the way to the marketplace.
export function JobOrdersCard({ figures, type, lang, slug }: Place & { figures: NetworkFigures; type: PartnerType }) {
  const recruitment = type === "recruitment_company";
  return (
    <BlockCard id="job-orders-heading" title={recruitment ? "Fitting job orders" : "Workforce requests"}>
      {figures.fittingJobOrders === 0 ? (
        <>
          <p className="text-body text-muted-foreground">
            {recruitment
              ? "Add the countries you serve and the occupations you recruit for to see job orders."
              : "No requests fit your profile yet. Add served countries and occupations to receive more."}
          </p>
          <TextLink standalone href={workforceProfilePath(lang, slug)}>
            Go to your workforce profile
          </TextLink>
        </>
      ) : (
        <>
          <dl className="grid gap-3">
            <Figure label={recruitment ? "Open job orders that fit your profile" : "Open requests you can answer"}>
              <span className="text-figure tabular-nums">{formatCount(figures.fittingJobOrders)}</span>
            </Figure>
            {figures.matchingEmployers > 0 ? (
              <Figure label="Employers with fitting job orders">{formatCount(figures.matchingEmployers)}</Figure>
            ) : null}
          </dl>
          <p className="text-small text-muted-foreground">
            Counted from the countries you serve and the occupations you list, with the requests you were invited to.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <TextLink standalone href={jobOrdersPath(lang, slug)}>
              See the job orders
            </TextLink>
            {figures.matchingEmployers > 0 ? (
              <TextLink standalone href={findEmployersPath(lang, slug)}>
                {recruitment ? "Find employers" : "Find companies"}
              </TextLink>
            ) : null}
          </div>
        </>
      )}
    </BlockCard>
  );
}

// The invitations still waiting for the company's answer (FR-R3 AC5, AC7, FR-R4 AC3).
export function InvitationsCard({ figures, lang, slug }: Place & { figures: NetworkFigures }) {
  const awaiting = figures.invitationsAwaiting;
  return (
    <BlockCard id="invitations-heading" title="Invitations">
      {awaiting === 0 ? (
        <p className="text-body text-muted-foreground">
          No invitations wait for your answer. Employers invite partners whose profile fits their request.
        </p>
      ) : (
        <dl>
          <Figure label="Waiting for your answer">
            <span className="text-figure tabular-nums">{formatCount(awaiting)}</span>
          </Figure>
        </dl>
      )}
      <TextLink standalone href={invitationsPath(lang, slug)}>
        {awaiting === 0 ? "See your invitations" : awaiting === 1 ? "Answer the invitation" : "Answer the invitations"}
      </TextLink>
    </BlockCard>
  );
}

// The company's responses by the employer's decision; selected responses are a staffing company's projects (FR-R4 AC6).
export function ResponsesCard({ figures, type, lang, slug }: Place & { figures: NetworkFigures; type: PartnerType }) {
  const rows = [
    { label: "Waiting for the employer's decision", count: figures.responsesOpen },
    { label: "Shortlisted", count: figures.responsesShortlisted },
    { label: type === "staffing_company" ? "Selected (projects)" : "Selected", count: figures.responsesSelected },
    { label: "Not selected", count: figures.responsesDeclined },
  ].filter((row) => row.count > 0);
  return (
    <BlockCard id="responses-heading" title="Responses and decisions">
      {rows.length === 0 ? (
        <>
          <p className="text-body text-muted-foreground">
            No responses yet. Respond to a job order that fits your profile and the employer&apos;s decision shows here.
          </p>
          <TextLink standalone href={jobOrdersPath(lang, slug)}>
            Find job orders
          </TextLink>
        </>
      ) : (
        <>
          <dl className="grid gap-3">
            {rows.map((row) => (
              <Figure key={row.label} label={row.label}>
                {formatCount(row.count)}
              </Figure>
            ))}
          </dl>
          <TextLink standalone href={responsesPath(lang, slug)}>
            See your responses
          </TextLink>
        </>
      )}
    </BlockCard>
  );
}

function Outcomes({ outcomes, lang, slug }: Place & { outcomes: SubmissionOutcome[] }) {
  if (outcomes.length === 0) return null;
  return (
    <div className="grid gap-2">
      <h3 id="outcomes-heading" className="text-body font-medium">
        Outcomes by job order
      </h3>
      <ul aria-labelledby="outcomes-heading" className="grid gap-2">
        {outcomes.map((outcome) => (
          <li key={outcome.requirementId} className="grid gap-0.5">
            <TextLink href={requirementSubmissionsPath(lang, slug, outcome.requirementId)}>{outcome.title}</TextLink>
            <span className="text-small text-muted-foreground">{outcomeText(outcome)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The company's candidate submissions by stage (FR-R3 AC5, AC7) and, per job order, how many were hired or not selected
// (FR-O5 AC10). The outcomes are a read of their own, made only when there is a submission, so a failure there leaves
// the counts in place.
export function SubmissionsCard({
  stages,
  organizationId,
  lang,
  slug,
}: Place & { stages: Record<SubmissionStatus, number>; organizationId: string }) {
  const lines = submissionStageLines(stages);
  return (
    <BlockCard id="submissions-heading" title="Candidate submissions">
      {lines.length === 0 ? (
        <>
          <p className="text-body text-muted-foreground">
            No candidates submitted yet. Once an employer shortlists or selects your response, you can submit candidates for it.
          </p>
          <TextLink standalone href={jobOrdersPath(lang, slug)}>
            Find job orders
          </TextLink>
        </>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            {lines.map((line) => (
              <Figure key={line.status} label={line.label}>
                {formatCount(line.count)}
              </Figure>
            ))}
          </dl>
          <Panel promise={getSubmissionOutcomes(organizationId)} errorTitle="The outcomes of your submissions could not be loaded">
            {(value) => <Outcomes outcomes={value} lang={lang} slug={slug} />}
          </Panel>
          <TextLink standalone href={partnerSubmissionsPath(lang, slug)}>
            See your candidates
          </TextLink>
        </>
      )}
    </BlockCard>
  );
}
