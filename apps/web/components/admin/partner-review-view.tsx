import { notFound } from "next/navigation";
import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { PartnerDecisionControls } from "@/components/admin/partner-decision";
import { PartnerEvidenceButton } from "@/components/admin/partner-evidence-button";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { partnerTypeLabels } from "@/components/forms/account-kind-options";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { getPartnerReviewDetail, type PartnerReviewDetail } from "@/lib/dal/admin-partner-reviews";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import type { PlatformRole } from "@/lib/validation/admin";
import { evidenceStatusLabels } from "@/lib/validation/licence-status";
import { identifierKindLabels } from "@/lib/validation/organization";
import {
  awaitingReview,
  decisionLabels,
  infoStepStaffLabels,
  reviewOverdue,
  reviewStatusLabels,
  STAFF_REVIEW_CHECKS,
} from "@/lib/validation/partner-review";
import { recruitmentTypeLabels, sizeBandLabels, staffingTypeLabels } from "@/lib/validation/workforce-offer";

const organizationTypeLabels = { employer: "Employer", ...partnerTypeLabels } as const;

const serviceLabels: Record<PartnerReviewDetail["serviceTypes"][number], string> = { staffing: "Staffing", ...staffingTypeLabels };

const listed = (items: readonly string[]) => (items.length > 0 ? items.join(", ") : "None chosen");

type LicencesProps = { review: PartnerReviewDetail; canOpen: boolean; countryName: ReadonlyMap<string, string> };

function Licences({ review, canOpen, countryName }: LicencesProps) {
  if (review.licences.length === 0) {
    return <p className="text-body">The company has declared no licences.</p>;
  }
  return (
    <ResultsTable caption="Licences" columns={["Country", "Authority and number", "Valid until", "Evidence"]}>
      {review.licences.map((licence) => (
        <tr key={licence.id}>
          <td className={cell}>{countryName.get(licence.country) ?? licence.country}</td>
          <td className={`${cell} break-words`}>
            {licence.issuingAuthority}
            <span className="block font-mono text-small">{licence.licenceNumber}</span>
          </td>
          <td className={cell}>
            {formatDate(licence.validUntil)}
            {licence.status === "expired" ? (
              <StatusBadge status="danger" className="mt-1 block w-fit">
                Expired
              </StatusBadge>
            ) : null}
          </td>
          <td className={cell}>
            {licence.evidence === null ? (
              "No file"
            ) : licence.evidence.status === "clean" || licence.evidence.status === "skipped" ? (
              canOpen ? (
                <PartnerEvidenceButton licenceId={licence.id} country={countryName.get(licence.country) ?? licence.country} />
              ) : (
                "File received. Reviewers open it."
              )
            ) : (
              evidenceStatusLabels[licence.evidence.status]
            )}
          </td>
        </tr>
      ))}
    </ResultsTable>
  );
}

type PartnerReviewViewProps = { lang: string; id: string; roles: readonly PlatformRole[] };

// What a reviewer checks before deciding (FR-J4 AC2): the company and its identifier, the organisations that name the same
// identifier, where it serves, what it offers, its licences with their evidence, its commitment and the decisions so far.
// No worker data and no member contact details other than the owner's email. Trust & Safety decide; the two other roles
// read.
export async function PartnerReviewView({ lang, id, roles }: PartnerReviewViewProps) {
  const [review, countries, industries] = await Promise.all([getPartnerReviewDetail(id), getCountries(), getIndustries()]);
  if (!review) notFound();
  const countryName = new Map(countries.map(({ code, name }) => [code, name]));
  const canDecide = roles.includes("trust_safety");
  const canOpenEvidence = roles.includes("trust_safety") || roles.includes("verification_reviewer");
  const canOpenOrganizations = roles.includes("trust_safety") || roles.includes("admin");
  const now = new Date();

  return (
    <div className="grid gap-page">
      <PageHeader title={review.displayName}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={awaitingReview(review.status) ? "warning" : "neutral"}>{reviewStatusLabels[review.status]}</StatusBadge>
          {review.organizationStatus === "active" ? null : <AccountStatusBadge status={review.organizationStatus} />}
        </div>
        <TextLink standalone href={adminPath(lang, "partners")}>
          Back to the partners to review
        </TextLink>
      </PageHeader>

      <Section id="company" title="Company">
        <DetailList
          items={[
            { label: "Legal name", value: review.legalName },
            { label: "Display name", value: review.displayName },
            { label: "Type", value: partnerTypeLabels[review.type] },
            {
              label: "Identifier",
              value: (
                <>
                  <span className="font-mono">{review.identifier ?? "None"}</span>
                  {review.identifierKind ? (
                    <span className="block text-small text-muted-foreground">{identifierKindLabels[review.identifierKind]}</span>
                  ) : null}
                </>
              ),
            },
            { label: "Country", value: countryName.get(review.country) ?? review.country },
            { label: "Industry", value: industries.find(({ code }) => code === review.industryCode)?.name ?? "None given" },
            {
              label: "Website",
              value: review.website ? (
                <TextLink href={review.website} target="_blank" rel="noopener noreferrer">
                  {review.website}
                  <span className="sr-only"> (opens in a new tab)</span>
                </TextLink>
              ) : (
                "None given"
              ),
            },
            { label: "Description", value: review.description ? <p className="whitespace-pre-line">{review.description}</p> : "None given" },
            { label: "Owner email", value: review.ownerEmail ?? "No owner" },
            { label: "Created", value: formatDateTime(review.createdAt) },
            { label: "Submitted", value: review.submittedAt ? formatDateTime(review.submittedAt) : "Not submitted" },
            ...(review.dueAt
              ? [
                  {
                    label: "Review target",
                    value: (
                      <>
                        {formatDateTime(review.dueAt)}{" "}
                        {reviewOverdue(review.dueAt, now) ? <StatusBadge status="danger">Overdue</StatusBadge> : null}
                      </>
                    ),
                  },
                ]
              : []),
            ...(review.listedAt ? [{ label: "First listed", value: formatDateTime(review.listedAt) }] : []),
          ]}
        />
      </Section>

      <Section
        id="identifier-links"
        title="Same identifier"
        description="Other organisations that name the same identifier. Only staff see this; the company is never told."
      >
        {review.links.length === 0 ? (
          <p className="text-body">No other organisation names this identifier.</p>
        ) : (
          <ul role="list" className="grid gap-2">
            {review.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {canOpenOrganizations ? (
                  <TextLink href={adminPath(lang, `organizations/${link.id}`)}>{link.legalName}</TextLink>
                ) : (
                  <span className="font-medium">{link.legalName}</span>
                )}
                <span className="text-muted-foreground">{organizationTypeLabels[link.type]}</span>
                {link.sameType ? <StatusBadge status="warning">Same type</StatusBadge> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="workforce" title="Where it serves and what it offers">
        <DetailList
          items={[
            { label: "Sources workers from", value: listed(review.sourcesFrom) },
            { label: review.type === "staffing_company" ? "Supplies workers for" : "Recruits for", value: listed(review.servesMarkets) },
            { label: "Occupations", value: listed(review.occupations) },
            { label: "Industries", value: listed(review.industries) },
            { label: "Languages", value: listed(review.languages) },
            { label: "Recruitment type", value: review.recruitmentType ? recruitmentTypeLabels[review.recruitmentType] : "Not chosen" },
            { label: "Services", value: listed(review.serviceTypes.map((service) => serviceLabels[service])) },
            { label: "Size", value: review.sizeBand ? sizeBandLabels[review.sizeBand] : "Not given" },
            { label: "Founded", value: review.foundedYear ? String(review.foundedYear) : "Not given" },
          ]}
        />
      </Section>

      <Section
        id="licences"
        title="Licences"
        description="As the company declared them. Opening a file is logged with your name and role."
      >
        <Licences review={review} canOpen={canOpenEvidence} countryName={countryName} />
      </Section>

      <Section id="commitment" title="Employer-pays commitment">
        <p className="text-body">
          {review.commitment.current
            ? `The owner has accepted the current version (${review.commitment.currentVersion ?? "draft"}).`
            : review.commitment.acceptedVersion !== null
              ? `The owner accepted version ${review.commitment.acceptedVersion}, not the current version.`
              : "The owner has not accepted the commitment."}
        </p>
      </Section>

      <Section id="decision" title="Decision" description="Check each point before you decide. The list is not saved.">
        <fieldset className="grid gap-2">
          <legend className="sr-only">Review checklist</legend>
          {STAFF_REVIEW_CHECKS.map((check, index) => (
            <div key={check} className="flex items-center gap-3">
              <input id={`review-check-${index}`} type="checkbox" className="size-5 accent-foreground" />
              <label htmlFor={`review-check-${index}`} className="text-body">
                {check}
              </label>
            </div>
          ))}
        </fieldset>
        {awaitingReview(review.status) ? (
          canDecide ? (
            <PartnerDecisionControls lang={lang} organizationId={review.id} companyName={review.legalName} />
          ) : (
            <Notice tone="info" role="status">
              Read only. Trust &amp; Safety decides on partners.
            </Notice>
          )
        ) : (
          <Notice tone="info" role="status">
            This company is not waiting for a decision: {reviewStatusLabels[review.status].toLowerCase()}.
          </Notice>
        )}
      </Section>

      <Section id="history" title="Decisions so far">
        {review.decisions.length === 0 ? (
          <p className="text-body">No decision yet.</p>
        ) : (
          <ol role="list" className="grid gap-4">
            {review.decisions.map((decision) => (
              <li key={decision.id} className="grid gap-1 border-b pb-4 last:border-b-0 last:pb-0">
                <p className="font-medium">
                  {decisionLabels[decision.decision]}
                  {decision.infoStep ? `: ${infoStepStaffLabels[decision.infoStep]}` : ""}
                </p>
                <p className="text-small text-muted-foreground">
                  <time dateTime={decision.decidedAt}>{formatDateTime(decision.decidedAt)}</time>
                  {decision.decidedByEmail ? ` by ${decision.decidedByEmail}` : ""}
                </p>
                <p className="whitespace-pre-line break-words">{decision.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
