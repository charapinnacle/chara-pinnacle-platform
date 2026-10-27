import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalEntityForm } from "@/components/billing/legal-entity-form";
import { PastDueAlert } from "@/components/billing/past-due-alert";
import { PlanActions } from "@/components/billing/plan-actions";
import { PlanChoices } from "@/components/billing/plan-choices";
import { PlanSummary } from "@/components/billing/plan-summary";
import { UsageSection } from "@/components/billing/usage-section";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { organizationCrumb } from "@/lib/app/navigation";
import { planChanges, type SubscriptionStatus } from "@/lib/billing/presentation";
import { getBillingState, getSubscription, getUsage, listSoldPlans } from "@/lib/dal/billing";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { identifierKindLabels as kindLabels } from "@/lib/validation/organization";

export const metadata: Metadata = { title: "Billing", robots: { index: false } };

// The statuses whose plan limits apply: the database gives any other status (a paused one) the limits of the free plan.
const ENTITLED_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due"];

// A recruitment or staffing company has the page while release 2a is on (FR-R1): the plans of its own type, which are the
// only ones its checkout sells.
export default async function BillingPage({ params }: PageProps<"/[lang]/org/[slug]/billing">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "admin", { hideFromOutsiders: true, partner: "either" });
  const partner = organization.type !== "employer";
  if (partner && !(await isReleased("release_partner_directories"))) notFound();
  const [subscription, state, plans] = await Promise.all([
    getSubscription(organization.id),
    getBillingState(organization.id),
    listSoldPlans(organization.type),
  ]);
  const live = subscription !== null && subscription.status !== "canceled";
  const entitled = subscription !== null && ENTITLED_STATUSES.includes(subscription.status);
  const isOwner = organization.role === "owner";
  const plan = subscription ? plans.find((candidate) => candidate.code === subscription.planCode) : undefined;
  const requirements = !partner && (await isReleased("release_job_orders"));
  const usage = entitled ? await getUsage(organization.id, organization.type, requirements ? ["active_requirements"] : []) : [];
  const changes = entitled && state.has_customer ? planChanges(subscription.planCode, plans) : [];
  const canUpgrade = changes.some((change) => change.kind === "upgrade");

  return (
    <div className="grid w-full gap-section">
      <PageHeader
        title="Billing"
        description={organization.displayName}
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Billing" }]} />}
      />

      {subscription?.status === "past_due" && subscription.pastDueSince ? (
        <PastDueAlert slug={slug} pastDueSince={new Date(subscription.pastDueSince)} now={new Date()} />
      ) : null}

      <div className="grid items-start gap-page lg:grid-cols-2">
        <PlanSummary subscription={subscription} plan={plan} partner={partner} />
        {entitled ? <UsageSection usage={usage} upgradeHref={canUpgrade ? "#plan-actions" : null} /> : null}
      </div>

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
          <h2 id="identifier-heading" className="text-h2">
            Company identifier
          </h2>
          {state.identifier_locked || partner ? (
            <p className="text-body text-muted-foreground">
              {state.identifier
                ? `${kindLabels[state.identifier_kind ?? ""] ?? "Identifier"}: ${state.identifier}. `
                : null}
              {partner
                ? "It decides whether your company can have a free trial. It was recorded with your company details."
                : "It cannot be changed once a payment has been started for the company."}
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
