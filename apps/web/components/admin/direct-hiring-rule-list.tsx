import { Globe } from "lucide-react";
import { DeleteDirectHiringRuleDialog } from "@/components/admin/delete-direct-hiring-rule-dialog";
import { DirectHiringRuleDialog } from "@/components/admin/direct-hiring-rule-dialog";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Section } from "@/components/layout/section";
import { listDirectHiringRules } from "@/lib/dal/direct-hiring-rules";
import { getCountries } from "@/lib/dal/reference";
import { formatDate } from "@/lib/i18n/format";
import { destinationText, ruleAgeText, ruleLabels, type DirectHiringRuleValue } from "@/lib/validation/direct-hiring-rules";

const ruleTones = { allowed: "success", licensed_partner_required: "warning", blocked: "danger" } as const satisfies Record<DirectHiringRuleValue, string>;

// The direct-hiring rules with their notice, legal opinion reference and age (FR-Q5 AC10, SOP P2-34 step 6). A rule
// unchanged for the review period is flagged "Review due".
export async function DirectHiringRuleList() {
  const [rules, countries] = await Promise.all([listDirectHiringRules(), getCountries()]);
  const now = new Date();

  return (
    <Section
      id="rules"
      title="Rules"
      description="One rule per source country and destination. A rule for a single destination comes before the rule for all destinations of the same source country."
    >
      <div>
        <DirectHiringRuleDialog countries={countries} />
      </div>
      {rules.length === 0 ? (
        <EmptyState icon={Globe} flat title="No rules yet, direct hiring is allowed with the general notice" />
      ) : (
        <ResultsTable caption="Direct-hiring rules" columns={["Countries", "Rule", "Notice", "Legal opinion", "Last change", "Actions"]}>
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td className={`${cell} break-words`}>
                <span className="block font-medium">{rule.sourceName}</span>
                <span className="block text-small text-muted-foreground">to {destinationText(rule.destinationName)}</span>
              </td>
              <td className={cell}>
                <StatusBadge status={ruleTones[rule.rule]}>{ruleLabels[rule.rule]}</StatusBadge>
              </td>
              <td className={`${cell} min-w-48 break-words`}>{rule.notice}</td>
              <td className={`${cell} break-words`}>{rule.legalOpinionRef}</td>
              <td className={`${cell} min-w-40`}>
                <span className="block">{ruleAgeText(rule.updatedAt, now)}</span>
                <span className="block text-small text-muted-foreground">
                  <time dateTime={rule.updatedAt}>{formatDate(rule.updatedAt)}</time>
                  {rule.updatedByName ? ` by ${rule.updatedByName}` : null}
                </span>
                {rule.reviewDue ? (
                  <StatusBadge status="warning" className="mt-1">
                    Review due
                  </StatusBadge>
                ) : null}
              </td>
              <td className={cell}>
                <div className="grid gap-2">
                  <DirectHiringRuleDialog countries={countries} rule={rule} />
                  <DeleteDirectHiringRuleDialog rule={rule} />
                </div>
              </td>
            </tr>
          ))}
        </ResultsTable>
      )}
    </Section>
  );
}
