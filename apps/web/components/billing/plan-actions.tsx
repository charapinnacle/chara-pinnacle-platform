import { PortalButton } from "@/components/billing/portal-button";
import type { PlanChange } from "@/lib/billing/presentation";

type PlanActionsProps = { slug: string; changes: PlanChange[]; live: boolean };

// Every control opens the Customer Portal of the organisation, which hosts the plan switch, the tax details and the
// invoices; CHARA never sees or stores card details. A lapsed organisation keeps only its invoices.
export function PlanActions({ slug, changes, live }: PlanActionsProps) {
  return (
    <section id="plan-actions" aria-labelledby="actions-heading" className="grid gap-3">
      <h2 id="actions-heading" className="text-h2">
        Plan, tax details and invoices
      </h2>
      <p className="text-body text-muted-foreground">
        You manage these on the page of our payment provider. CHARA never sees or stores your card details.
      </p>
      <div className="flex flex-wrap gap-3">
        {live ? (
          <>
            {changes.map((change) => (
              <PortalButton key={change.plan.code} slug={slug} label={change.label} variant="primary" />
            ))}
            <PortalButton slug={slug} label="Manage billing" variant="secondary" />
            <PortalButton slug={slug} label="Change tax details" variant="secondary" />
          </>
        ) : null}
        <PortalButton slug={slug} label="View invoices" variant="secondary" />
      </div>
    </section>
  );
}
