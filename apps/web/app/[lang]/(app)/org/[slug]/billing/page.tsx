import type { Metadata } from "next";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { LegalEntityForm } from "@/components/billing/legal-entity-form";
import { PastDueAlert } from "@/components/billing/past-due-alert";
import { PortalButton } from "@/components/billing/portal-button";
import { formatDate } from "@/lib/i18n/format";
import { priceLine, daysText, subscriptionStatusLabels } from "@/lib/billing/presentation";
import { getBillingState, getSubscription, listSoldPlans } from "@/lib/dal/billing";
import { requireOrgRole } from "@/lib/dal/session";
import { identifierKindOptions } from "@/lib/validation/organization";

export const metadata: Metadata = { title: "Billing — CHARA", robots: { index: false } };

const kindLabels = Object.fromEntries(identifierKindOptions.map((option) => [option.value, option.label]));

export default async function BillingPage({ params }: PageProps<"/[lang]/org/[slug]/billing">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "admin");
  const [subscription, state, plans] = await Promise.all([
    getSubscription(organization.id),
    getBillingState(organization.id),
    listSoldPlans(),
  ]);
  const live = subscription !== null && subscription.status !== "canceled";
  const isOwner = organization.role === "owner";

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Billing</h1>
        <p className="text-body text-muted-foreground">{organization.displayName}</p>
      </header>

      {subscription?.status === "past_due" && subscription.pastDueSince ? (
        <PastDueAlert slug={slug} pastDueSince={new Date(subscription.pastDueSince)} now={new Date()} />
      ) : null}

      {subscription ? (
        <section aria-labelledby="plan-heading" className="grid gap-2 rounded-xl border bg-card p-4">
          <h2 id="plan-heading" className="text-lg font-semibold">
            Current plan
          </h2>
          <p>
            <span className="font-medium">{subscription.planName ?? "Plan"}</span> · Status:{" "}
            {subscriptionStatusLabels[subscription.status]}
          </p>
          {subscription.status === "trialing" && subscription.trialEndsAt ? (
            <p className="text-sm text-muted-foreground">Your free trial ends on {formatDate(subscription.trialEndsAt)}.</p>
          ) : null}
          {subscription.status === "active" && subscription.currentPeriodEnd ? (
            <p className="text-sm text-muted-foreground">Your plan renews on {formatDate(subscription.currentPeriodEnd)}.</p>
          ) : null}
        </section>
      ) : null}

      {state.has_customer ? (
        <section aria-labelledby="portal-heading" className="grid gap-3">
          <h2 id="portal-heading" className="text-lg font-semibold">
            Payment method, plan changes and invoices
          </h2>
          <p className="text-body text-muted-foreground">
            You manage these on the page of our payment provider. CHARA never sees or stores your card details.
          </p>
          <PortalButton slug={slug} />
        </section>
      ) : null}

      {live ? null : (
        <section aria-labelledby="plans-heading" className="grid gap-3">
          <h2 id="plans-heading" className="text-lg font-semibold">
            Choose a plan
          </h2>
          <Notice tone="info" role="status">
            You have no active subscription, and no payment was taken.
          </Notice>
          <ul className="grid gap-3">
            {plans.map((plan) => {
              const trialDays = state.trial_used ? 0 : plan.trialDays;
              return (
                <li key={plan.code} className="grid gap-1 rounded-xl border bg-card p-4">
                  <h3 className="font-medium">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground">{priceLine(plan)}</p>
                  <p className="text-sm text-muted-foreground">
                    {trialDays > 0 ? `${daysText(trialDays)} free trial` : "No free trial"}
                  </p>
                  <TextLink standalone href={`/${lang}/org/${slug}/billing/checkout?plan=${plan.code}`}>
                    Choose {plan.name}
                  </TextLink>
                </li>
              );
            })}
          </ul>
        </section>
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
