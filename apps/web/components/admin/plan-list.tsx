import { Layers } from "lucide-react";
import { PlanEditDialog } from "@/components/admin/plan-edit-dialog";
import { PlanPriceDialog } from "@/components/admin/plan-price-dialog";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { Section } from "@/components/layout/section";
import { formatPrice } from "@/lib/billing/presentation";
import { listEditorPlans } from "@/lib/dal/plan-editor";
import { adminPath } from "@/lib/routes";
import { limitText, organizationTypeSections } from "@/lib/validation/plan-editor";

// The plans of each organisation type with every limit and feature (FR-R2 AC1); null limits read Unlimited. A paid plan's
// price is changed at the payment provider (AC8); free plans stay free.
export async function PlanList({ lang }: { lang: string }) {
  const plans = await listEditorPlans();
  if (plans.length === 0) return <EmptyState icon={Layers} title="No plans" description="The plan rows are loaded by the reference seed." />;

  return (
    <div className="grid gap-page">
      {Object.entries(organizationTypeSections).map(([type, title]) => {
        const rows = plans.filter((plan) => plan.orgType === type);
        return (
          <Section key={type} id={type} title={title}>
            {rows.length === 0 ? (
              <EmptyState flat title={`No plans for ${title.toLowerCase()}`} />
            ) : (
              <ResultsTable
                caption={`Plans for ${title.toLowerCase()}`}
                columns={["Plan", "Price", "Visibility", "Trial days", "Contact sales", "Limits", "Features", "Actions"]}
              >
                {rows.map((plan) => (
                  <tr key={plan.code}>
                    <td className={`${cell} break-words`}>
                      <span className="block font-medium">{plan.name}</span>
                      <span className="block text-small text-muted-foreground wrap-break-word">{plan.code}</span>
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>{formatPrice(plan.priceMinor, plan.currency)}</td>
                    <td className={cell}>{plan.isPublic ? "Public" : "Not public"}</td>
                    <td className={cell}>{plan.trialDays}</td>
                    <td className={cell}>{plan.contactSales ? "Yes" : "No"}</td>
                    <td className={cell}>
                      <ul className="grid gap-0.5 text-small">
                        {plan.limits.map((limit) => (
                          <li key={limit.key}>
                            {limit.label}: <span className="font-medium tabular-nums">{limitText(limit.value)}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={cell}>
                      <ul className="grid gap-0.5 text-small">
                        {plan.features.map((feature) => (
                          <li key={feature.key}>
                            {feature.label}: {feature.enabled ? "On" : "Off"}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={cell}>
                      <div className="grid justify-items-start gap-2">
                        <PlanEditDialog plan={plan} />
                        {plan.priceMinor > 0 ? <PlanPriceDialog plan={plan} /> : null}
                        <TextLink href={adminPath(lang, `plans/${plan.code}`)}>
                          History<span className="sr-only"> of {plan.name} ({plan.code})</span>
                        </TextLink>
                      </div>
                    </td>
                  </tr>
                ))}
              </ResultsTable>
            )}
          </Section>
        );
      })}
    </div>
  );
}
