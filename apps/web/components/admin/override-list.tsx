import { SlidersHorizontal } from "lucide-react";
import { OverrideFormView } from "@/components/admin/override-form";
import { RemoveOverrideDialog } from "@/components/admin/remove-override-dialog";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Section } from "@/components/layout/section";
import { listEditorPlans, listEnterpriseOrganizations, listLimitOverrides } from "@/lib/dal/plan-editor";
import { formatShortDate } from "@/lib/i18n/format";
import { limitText, organizationTypeSections } from "@/lib/validation/plan-editor";

// The limit overrides, active first, and the form for a new one (FR-R2 AC5, AC11). An expired override is marked and no
// longer applies; it stays listed until it is removed or replaced.
export async function OverrideList() {
  const [overrides, organizations, plans] = await Promise.all([listLimitOverrides(), listEnterpriseOrganizations(), listEditorPlans()]);
  const limitKeys = Object.fromEntries(
    Object.keys(organizationTypeSections).map((type) => [
      type,
      plans.find((plan) => plan.orgType === type)?.limits.map(({ key, label }) => ({ key, label })) ?? [],
    ]),
  );

  return (
    <div className="grid gap-page">
      <Section id="current" title="Overrides">
        {overrides.length === 0 ? (
          <EmptyState flat icon={SlidersHorizontal} title="No limit overrides" description="An override replaces one plan limit of an Enterprise organisation until its expiry." />
        ) : (
          <ResultsTable caption="Limit overrides" columns={["Organisation", "Limit", "Value", "Plan limit", "Expires", "Reason", "Actions"]}>
            {overrides.map((row) => (
              <tr key={`${row.organizationId}-${row.limitKey}`}>
                <td className={`${cell} break-words`}>
                  <span className="block font-medium">{row.organizationName}</span>
                  <span className="block text-small text-muted-foreground break-all">{row.planCode}</span>
                </td>
                <td className={cell}>{row.limitLabel}</td>
                <td className={`${cell} tabular-nums`}>{limitText(row.value)}</td>
                <td className={`${cell} tabular-nums`}>{limitText(row.planLimit)}</td>
                <td className={cell}>
                  {row.expiresAt ? <time dateTime={row.expiresAt}>{formatShortDate(row.expiresAt)}</time> : "No expiry"}
                  {row.expired ? (
                    <StatusBadge status="neutral" className="mt-1 block w-fit">
                      Expired
                    </StatusBadge>
                  ) : null}
                </td>
                <td className={`${cell} break-words`}>{row.reason ?? <span className="text-muted-foreground">None recorded</span>}</td>
                <td className={cell}>
                  <RemoveOverrideDialog
                    organizationId={row.organizationId}
                    organizationName={row.organizationName}
                    limitKey={row.limitKey}
                    limitLabel={row.limitLabel}
                  />
                </td>
              </tr>
            ))}
          </ResultsTable>
        )}
      </Section>
      <Section id="new" title="Set an override" description="For an organisation on an Enterprise plan. Saving a limit that has an override replaces it.">
        {organizations.length === 0 ? (
          <EmptyState flat title="No organisation is on an Enterprise plan" />
        ) : (
          <OverrideFormView
            organizations={organizations.map((organization) => ({
              id: organization.id,
              label: `${organization.displayName} (${organization.planCode})`,
              orgType: organization.orgType,
            }))}
            limitKeys={limitKeys}
          />
        )}
      </Section>
    </div>
  );
}
