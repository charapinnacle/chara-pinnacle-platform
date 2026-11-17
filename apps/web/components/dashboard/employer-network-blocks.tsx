import { BlockCard, Figure } from "@/components/dashboard/block-card";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import {
  employerStageLines,
  firstWaiting,
  invitationAnswerLines,
  invitedPartnersText,
  requirementAction,
  responsesText,
  type NetworkRequirement,
  type RequirementFigures,
} from "@/lib/dashboard/employer-network";
import { formatCount, formatDate } from "@/lib/i18n/format";
import { UPDATED_BADGE } from "@/lib/responses/presentation";
import { requirementStatusLabels, requirementStatusTones } from "@/lib/requirements/presentation";
import {
  followingPath,
  requirementPartnersPath,
  requirementResponsesComparePath,
  requirementResponsesPath,
  requirementsPath,
  savedPartnersPath,
  submissionPipelinePath,
} from "@/lib/routes";
import type { PipelineSubmissionStage } from "@/lib/submissions/presentation";

type Place = { lang: string; slug: string };

function RequirementItem({ requirement, lang, slug }: Place & { requirement: NetworkRequirement }) {
  const action = requirementAction(requirement);
  const href =
    action.kind === "invite" ? requirementPartnersPath(lang, slug, requirement.id) : requirementResponsesPath(lang, slug, requirement.id);
  return (
    <li className="grid gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-body font-medium">{requirement.title}</span>
        <StatusBadge status={requirementStatusTones[requirement.status]}>
          <span className="sr-only">Status: </span>
          {requirementStatusLabels[requirement.status]}
        </StatusBadge>
        {requirement.updatedUnseen > 0 ? <StatusBadge status="warning">{UPDATED_BADGE}</StatusBadge> : null}
      </span>
      <span className="text-small text-muted-foreground">
        {responsesText(requirement.responses)}
        <span className="sr-only"> to {requirement.title}</span>
        {requirement.selected > 0 ? `, ${formatCount(requirement.selected)} selected` : null}
        {requirement.invitationsWaiting > 0 ? `, ${formatCount(requirement.invitationsWaiting)} invited without an answer yet` : null}
        {requirement.closesOn ? ` · closes ${formatDate(requirement.closesOn)}` : null}
      </span>
      <TextLink href={href} className="justify-self-start text-small">
        {action.text}
        <span className="sr-only"> for {requirement.title}</span>
      </TextLink>
    </li>
  );
}

// The open and paused workforce requirements with their responses and next action (FR-R5 AC3, AC9, NFR-U4).
export function RequirementsCard({ figures, lang, slug, canManage }: Place & { figures: RequirementFigures; canManage: boolean }) {
  const live = figures.open + figures.paused;
  if (live === 0) {
    return (
      <BlockCard id="requirements-heading" title="Workforce requirements">
        <p className="text-body text-muted-foreground">
          {canManage
            ? "Post a workforce requirement to ask partners for a group of workers, for example 20 welders for Germany."
            : "An owner or admin of your company posts workforce requirements to ask partners for a group of workers."}
        </p>
        {figures.drafts > 0 ? (
          <p className="text-small text-muted-foreground">
            {figures.drafts === 1 ? "1 draft is" : `${formatCount(figures.drafts)} drafts are`} not published yet.
          </p>
        ) : null}
        {canManage ? (
          figures.drafts > 0 ? (
            <TextLink standalone href={requirementsPath(lang, slug)}>
              Publish a draft
            </TextLink>
          ) : (
            <LinkButton href={`${requirementsPath(lang, slug)}/new`} className="justify-self-start">
              Post workforce requirement
            </LinkButton>
          )
        ) : null}
      </BlockCard>
    );
  }
  const more = live - figures.listed.length;
  return (
    <BlockCard id="requirements-heading" title="Workforce requirements">
      <dl className="grid grid-cols-3 gap-3">
        <Figure label="Open">{formatCount(figures.open)}</Figure>
        {figures.paused > 0 ? <Figure label="Paused">{formatCount(figures.paused)}</Figure> : null}
        {figures.drafts > 0 ? <Figure label="Drafts">{formatCount(figures.drafts)}</Figure> : null}
      </dl>
      <ul aria-labelledby="requirements-heading" className="grid gap-3">
        {figures.listed.map((requirement) => (
          <RequirementItem key={requirement.id} requirement={requirement} lang={lang} slug={slug} />
        ))}
      </ul>
      <TextLink standalone href={requirementsPath(lang, slug)}>
        {more > 0 ? `See all ${formatCount(live)} requirements` : "See your requirements"}
      </TextLink>
    </BlockCard>
  );
}

// The partners invited to open and paused requirements, their answers and the partners selected (FR-R5 AC4, AC9).
export function PartnersCard({ figures, findPartnersHref }: { figures: RequirementFigures; findPartnersHref: string }) {
  const answers = invitationAnswerLines(figures);
  const empty = figures.invitedPartners === 0 && figures.selectedPartners === 0;
  return (
    <BlockCard id="partners-heading" title="Partners invited and selected">
      {empty ? (
        <p className="text-body text-muted-foreground">Invite recruitment or staffing partners from a requirement.</p>
      ) : (
        <dl className="grid gap-3">
          {figures.invitedPartners > 0 ? <Figure label="Invited">{invitedPartnersText(figures)}</Figure> : null}
          {answers.map((line) => (
            <Figure key={line.label} label={line.label}>
              {formatCount(line.count)}
            </Figure>
          ))}
          {figures.selectedPartners > 0 ? <Figure label="Selected partners">{formatCount(figures.selectedPartners)}</Figure> : null}
        </dl>
      )}
      <TextLink standalone href={findPartnersHref}>
        Find partners
      </TextLink>
    </BlockCard>
  );
}

// The responses waiting for the employer's decision, with those updated since last opened (FR-O2 AC9, FR-O3).
export function ResponsesWaitingCard({ figures, lang, slug }: Place & { figures: RequirementFigures }) {
  const first = firstWaiting(figures.listed);
  return (
    <BlockCard id="responses-waiting-heading" title="Responses waiting for your decision">
      {figures.responsesWaiting === 0 ? (
        <>
          <p className="text-body text-muted-foreground">
            {figures.responsesShortlisted > 0
              ? `No new response waits. ${formatCount(figures.responsesShortlisted)} shortlisted ${figures.responsesShortlisted === 1 ? "response waits" : "responses wait"} for your selection.`
              : "No response waits for your decision. Partners' responses to your open requirements show here."}
          </p>
          <TextLink standalone href={requirementsPath(lang, slug)}>
            See your requirements
          </TextLink>
        </>
      ) : (
        <>
          <dl className="grid gap-3">
            <Figure label="Waiting for a decision">
              <span className="text-figure tabular-nums">{formatCount(figures.responsesWaiting)}</span>
            </Figure>
            {figures.responsesUpdated > 0 ? (
              <Figure label="Updated since you last opened them">
                <span className="flex items-center gap-2">
                  {formatCount(figures.responsesUpdated)}
                  <StatusBadge status="warning">{UPDATED_BADGE}</StatusBadge>
                </span>
              </Figure>
            ) : null}
            {figures.responsesShortlisted > 0 ? <Figure label="Shortlisted">{formatCount(figures.responsesShortlisted)}</Figure> : null}
          </dl>
          {first ? (
            <TextLink standalone href={requirementResponsesComparePath(lang, slug, first.id)}>
              Compare the responses to {first.title}
            </TextLink>
          ) : (
            <TextLink standalone href={requirementsPath(lang, slug)}>
              See your requirements
            </TextLink>
          )}
        </>
      )}
    </BlockCard>
  );
}

// The candidates partners submitted and the workers approved, by stage of the pipeline, new ones first (FR-O5).
export function EmployerSubmissionsCard({ stages, lang, slug }: Place & { stages: Record<PipelineSubmissionStage, number> }) {
  const lines = employerStageLines(stages);
  return (
    <BlockCard id="employer-submissions-heading" title="Submitted candidates">
      {lines.length === 0 ? (
        <>
          <p className="text-body text-muted-foreground">
            No candidates submitted yet. Partners you shortlist or select can submit candidates for your requirement.
          </p>
          <TextLink standalone href={requirementsPath(lang, slug)}>
            See your requirements
          </TextLink>
        </>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            {lines.map((line) => (
              <Figure key={line.stage} label={line.label}>
                <TextLink
                  href={submissionPipelinePath(lang, slug, {
                    stage: line.stage,
                  })}
                  aria-label={`${line.label}: ${formatCount(line.count)}`}
                >
                  {formatCount(line.count)}
                </TextLink>
              </Figure>
            ))}
          </dl>
          <TextLink standalone href={submissionPipelinePath(lang, slug, stages.submitted > 0 ? { stage: "submitted" } : {})}>
            {stages.submitted > 0
              ? `Review ${formatCount(stages.submitted)} new ${stages.submitted === 1 ? "candidate" : "candidates"}`
              : "See the submitted candidates"}
          </TextLink>
        </>
      )}
    </BlockCard>
  );
}

// The partners the organisation saved (FR-L4 AC10, FR-R5 AC4, AC9); a suspended partner is not counted.
export function SavedPartnersCard({ count, findPartnersHref, lang, slug }: Place & { count: number; findPartnersHref: string }) {
  if (count > 0) return <SummaryCard label="Saved partners" value={count} href={savedPartnersPath(lang, slug)} />;
  return (
    <BlockCard id="saved-partners-heading" title="Saved partners">
      <p className="text-body text-muted-foreground">Save partners from their profile to find them here.</p>
      <TextLink standalone href={findPartnersHref}>
        Find partners
      </TextLink>
    </BlockCard>
  );
}

// The companies the user follows (FR-L4 AC10).
export function FollowedCompaniesCard({ count, findPartnersHref, lang }: { count: number; findPartnersHref: string; lang: string }) {
  if (count > 0) return <SummaryCard label="Followed companies" value={count} href={followingPath(lang)} />;
  return (
    <BlockCard id="followed-heading" title="Followed companies">
      <p className="text-body text-muted-foreground">Follow partners and companies from their page to hear when they publish.</p>
      <TextLink standalone href={findPartnersHref}>
        Find partners
      </TextLink>
    </BlockCard>
  );
}
