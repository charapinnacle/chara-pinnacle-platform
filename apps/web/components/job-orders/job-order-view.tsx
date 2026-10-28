import { TextLink } from "@/components/forms/text-link";
import type { JobOrder } from "@/lib/dal/job-orders";
import { formatDate } from "@/lib/i18n/format";
import { reasonOf, responsesText } from "@/lib/job-orders/presentation";
import { formatSalary } from "@/lib/jobs/presentation";
import { monthsText, workersText, yearsText } from "@/lib/requirements/presentation";
import { employmentTypeLabels, recruitmentPreferenceLabels } from "@/lib/validation/job";
import { partnerNeedLabels } from "@/lib/validation/requirement";

type Names = { countries: Map<string, string>; industries: Map<string, string> };

function yesNo(value: boolean | null): string {
  return value ? "Yes" : "No";
}

function dateOf(value: string): React.ReactNode {
  return <time dateTime={value}>{formatDate(value)}</time>;
}

// A job order as get_job_order returns it to this partner, and nothing more (NFR-S11): every field of an eligible
// partner's job order, or the destination, the size and why for a partner that sees only the title (FR-N1 AC2, AC3).
export function JobOrderView({
  order,
  names,
  context,
}: {
  order: JobOrder;
  names: Names;
  context: { lang: string; slug: string; canManage: boolean };
}) {
  const country = names.countries.get(order.countryCode) ?? order.countryCode;
  if (!order.eligible) {
    return (
      <section aria-labelledby="job-order-title-only-heading" className="grid gap-4">
        <h2 id="job-order-title-only-heading" className="text-h2">
          Only the title is shown to your company
        </h2>
        <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          <div className="grid content-start gap-0.5 bg-card p-card">
            <dt className="text-small text-muted-foreground">Destination</dt>
            <dd className="font-medium break-words">{country}</dd>
          </div>
          <div className="grid content-start gap-0.5 bg-card p-card">
            <dt className="text-small text-muted-foreground">Number of workers</dt>
            <dd className="font-medium">{workersText(order.workersNeeded)}</dd>
          </div>
        </dl>
        <ul className="grid gap-2 text-body">
          {order.reasons.map((reason) => {
            const { text, action } = reasonOf(reason, { ...context, country });
            return (
              <li key={reason}>
                {text} {action ? <TextLink href={action.href}>{action.label}</TextLink> : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  const destinations = order.countries.map((code) => names.countries.get(code) ?? code).join(", ");
  const responses = responsesText(order.responseCount, order.responsesFewerThan);
  const details: (readonly [string, React.ReactNode])[] = [
    ["Number of workers", workersText(order.workersNeeded)],
    ["Destination", order.cityRegion ? `${order.cityRegion}, ${country}` : country],
    ...(order.countries.length > 1 ? [["All destination countries", destinations] as const] : []),
    ["Industry", order.industryCode ? (names.industries.get(order.industryCode) ?? order.industryCode) : "Not stated"],
    ["Start date", order.startDate ? dateOf(order.startDate) : "Not stated"],
    ["Project duration", order.durationMonths === null ? "Permanent or open-ended" : monthsText(order.durationMonths)],
    ["Employment type", order.employmentType ? employmentTypeLabels[order.employmentType] : "Not stated"],
    ["Experience", order.experienceYears === null ? "Not stated" : yearsText(order.experienceYears)],
    ["Salary or budget", formatSalary(order) ?? "Not stated"],
    ["Accommodation", yesNo(order.accommodation)],
    ["Work permit support", yesNo(order.workPermitSupport)],
    ["Visa support", yesNo(order.visaSupport)],
    ["Recruitment", order.recruitmentPreference ? recruitmentPreferenceLabels[order.recruitmentPreference] : "Not stated"],
    ["Workforce partners", order.partnerNeed ? partnerNeedLabels[order.partnerNeed] : "Not stated"],
    ...(order.publishedOn ? [["Published on", dateOf(order.publishedOn)] as const] : []),
    ...(order.closesOn ? [["Open until", dateOf(order.closesOn)] as const] : []),
    ...(responses ? [["Responses", responses] as const] : []),
  ];

  return (
    <div className="grid content-start gap-10">
      <section aria-labelledby="job-order-occupations-heading" className="grid gap-3">
        <h2 id="job-order-occupations-heading" className="text-h2">
          Occupations
        </h2>
        <ul className="grid gap-px overflow-hidden rounded-xl border bg-border">
          {order.occupations.map((occupation) => (
            <li key={occupation.code} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-card p-card">
              <span className="font-medium break-words">
                {occupation.code} · {occupation.name}
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

      {order.skills ? (
        <section aria-labelledby="job-order-skills-heading" className="grid gap-3">
          <h2 id="job-order-skills-heading" className="text-h2">
            Skills
          </h2>
          <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{order.skills}</p>
        </section>
      ) : null}
    </div>
  );
}
