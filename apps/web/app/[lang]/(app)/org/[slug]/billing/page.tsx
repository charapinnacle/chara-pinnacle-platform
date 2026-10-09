import type { Metadata } from "next";
import { LegalEntityForm } from "@/components/billing/legal-entity-form";
import { PastDueAlert } from "@/components/billing/past-due-alert";
import { PlanActions } from "@/components/billing/plan-actions";
import { PlanChoices } from "@/components/billing/plan-choices";
import { PlanSummary } from "@/components/billing/plan-summary";
import { UsageSection } from "@/components/billing/usage-section";
import { planChanges } from "@/lib/billing/presentation";
import { getBillingState, getSubscription, getUsage, listSoldPlans } from "@/lib/dal/billing";
import { requireOrgRole } from "@/lib/dal/session";
import { identifierKindOptions } from "@/lib/validation/organization";

export const metadata: Metadata = { title: "Billing — CHARA", robots: { index: false } };

const kindLabels = Object.fromEntries(identifierKindOptions.map((option) => [option.value, option.label]));

export default async function BillingPage({ params }: PageProps<"/[lang]/org/[slug]/billing">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "admin", { hideFromOutsiders: true });
  const [subscription, state, plans, usage] = await Promise.all([
    getSubscription(organization.id),
    getBillingState(organization.id),
    listSoldPlans(),
    getUsage(organization.id),
  ]);
  const live = subscription !== null && subscription.status !== "canceled";
  const isOwner = organization.role === "owner";
  const plan = subscription ? plans.find((candidate) => candidate.code === subscription.planCode) : undefined;
  const changes = live ? planChanges(subscription.planCode, plans) : [];
  const canUpgrade = changes.some((change) => change.kind === "upgrade");

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Billing</h1>
        <p className="text-body text-muted-foreground">{organization.displayName}</p>
      </header>

      {subscription?.status === "past_due" && subscription.pastDueSince ? (
        <PastDueAlert slug={slug} pastDueSince={new Date(subscription.pastDueSince)} now={new Date()} />
      ) : null}

      <PlanSummary subscription={subscription} plan={plan} />

      {live ? <UsageSection usage={usage} upgradeHref={canUpgrade ? "#plan-actions" : null} /> : null}

      {state.has_customer ? <PlanActions slug={slug} changes={changes} live={live} /> : null}

      {live ? null : (
        <PlanChoices
          plans={plans}
          checkoutHref={(code) => `/${lang}/org/${slug}/billing/checkout?plan=${code}`}
          offerTrial={subscription === null && !state.trial_used}
        />
      )}

      {isOwner ? (
        <section aria-labelledby="identifier-heading" className="grid gap-3">
          <h2 id="identifier-heading" className="text-lg font-semibold">
            Company identifier
          </h2>
          {state.identifier_locked ? (
            <p className="text-body text-muted-foreground">
              {state.identifier
                ? `${kindLabels[state.identifier_kind ?? ""] ?? "Identifier"}: ${state.identifier}. `
                : null}
              It cannot be changed once a payment has been started for the company.
            </p>
          ) : (
            <>
              <p className="text-body text-muted-foreground">
                {state.identifier ? `Recorded: ${kindLabels[state.identifier_kind ?? ""] ?? "Identifier"} ${state.identifier}. ` : null}
                The identifier of your company decides whether it can have a free trial. Record it here, or enter it
                when you choose a plan.
              </p>
              <LegalEntityForm
                slug={slug}
                defaults={{ identifier: state.identifier ?? "", identifierKind: state.identifier_kind ?? "" }}
              />
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
