import type { Requirement } from "@/lib/dal/requirements";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { monthsText, workersText, yearsText } from "@/lib/requirements/presentation";
import { employmentTypeLabels, recruitmentPreferenceLabels } from "@/lib/validation/job";
import { partnerNeedLabels } from "@/lib/validation/requirement";
import { requirementVisibilityLabels } from "@/lib/validation/requirement-status";

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

// The fields of a requirement as its organisation reads them (FR-M1 AC1): the same facts as the form, in its order.
export function RequirementView({ requirement }: { requirement: Requirement }) {
  const details: (readonly [string, React.ReactNode])[] = [
    ["Number of workers", workersText(requirement.workersNeeded)],
    ["Location", `${requirement.cityRegion}, ${requirement.country}`],
    ["Industry", requirement.industry],
    ["Start date", <time key="start" dateTime={requirement.startDate}>{formatDate(requirement.startDate)}</time>],
    ["Project duration", requirement.durationMonths === null ? "Permanent or open-ended" : monthsText(requirement.durationMonths)],
    ["Employment type", employmentTypeLabels[requirement.employmentType]],
    ["Experience", requirement.experienceYears === null ? "Not stated" : yearsText(requirement.experienceYears)],
    ["Salary or budget", formatSalary(requirement) ?? "Not stated"],
    ["Accommodation", yesNo(requirement.accommodation)],
    ["Work permit support", yesNo(requirement.workPermitSupport)],
    ["Visa support", yesNo(requirement.visaSupport)],
    ["Recruitment", recruitmentPreferenceLabels[requirement.recruitmentPreference]],
    ["Workforce partners", partnerNeedLabels[requirement.partnerNeed]],
  ];
  if (requirement.visibility) {
    details.push([
      "Who can see it",
      requirement.visibility === "job_order_marketplace"
        ? `${requirementVisibilityLabels.job_order_marketplace}, ${requirement.showIdentity ? "with your company name" : "without your company name"}`
        : requirementVisibilityLabels.private,
    ]);
  }
  if (requirement.publishedAt) {
    details.push(["Published on", <time key="published" dateTime={requirement.publishedAt}>{formatDate(requirement.publishedAt)}</time>]);
  }

  return (
    <div className="grid content-start gap-10">
      <section aria-labelledby="requirement-occupations-heading" className="grid gap-3">
        <h2 id="requirement-occupations-heading" className="text-h2">
          Occupations
        </h2>
        <ul className="grid gap-px overflow-hidden rounded-xl border bg-border">
          {requirement.occupations.map((occupation) => (
            <li key={occupation.code} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-card p-card">
              <span className="font-medium break-words">
                {occupation.code} · {occupation.label}
              </span>
              <span className="tabular-nums text-muted-foreground">{workersText(occupation.quantity)}</span>
            </li>
          ))}
        </ul>
      </section>

      <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 sm:[&>:last-child:nth-child(odd)]:col-span-2">
        {details.map(([term, value]) => (
          <div key={term} className="grid content-start gap-0.5 bg-card p-card">
            <dt className="text-small text-muted-foreground">{term}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {requirement.skills ? (
        <section aria-labelledby="requirement-skills-heading" className="grid gap-3">
          <h2 id="requirement-skills-heading" className="text-h2">
            Skills
          </h2>
          <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{requirement.skills}</p>
        </section>
      ) : null}
    </div>
  );
}
