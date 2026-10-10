import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CheckoutForm } from "@/components/billing/checkout-form";
import { Card } from "@/components/layout/card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { organizationCrumb } from "@/lib/app/navigation";
import { checkoutDisclosures, formatPrice, type SoldPlan } from "@/lib/billing/presentation";
import { getBillingState, getSubscription, listSoldPlans, type BillingState } from "@/lib/dal/billing";
import { getLegalDocument } from "@/lib/dal/legal";
import { getCountries } from "@/lib/dal/reference";
import { requireOrgRole } from "@/lib/dal/session";
import { toOptions } from "@/lib/reference-options";
import { billingPath } from "@/lib/routes";
import { planCodeSchema } from "@/lib/validation/billing";

export const metadata: Metadata = { title: "Confirm your plan — CHARA", robots: { index: false } };

function identifierDefaults(state: BillingState) {
  const fromKind = (kinds: readonly string[]) =>
    state.identifier && state.identifier_kind && kinds.includes(state.identifier_kind) ? state.identifier : "";
  return {
    billingCountry: state.billing_country ?? "",
    vatId: state.vat_id ?? fromKind(["vat_number"]),
    registrationNumber: state.registration_number ?? fromKind(["registration_number", "other"]),
  };
}

export default async function CheckoutPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/billing/checkout">) {
  const [{ lang, slug }, { plan: planParam }] = await Promise.all([params, searchParams]);
  const { organization } = await requireOrgRole(lang, slug, "admin", { hideFromOutsiders: true });
  const code = planCodeSchema.safeParse(typeof planParam === "string" ? planParam : "");
  if (!code.success) notFound();

  const [plans, state, subscription, terms, countries] = await Promise.all([
    listSoldPlans(),
    getBillingState(organization.id),
    getSubscription(organization.id),
    getLegalDocument("subscription-and-billing-terms"),
    getCountries(),
  ]);
  const plan: SoldPlan | undefined = plans.find((candidate) => candidate.code === code.data);
  if (!plan || !terms) notFound();
  if (subscription && subscription.status !== "canceled") redirect(billingPath(lang, slug));

  const trialDays = state.trial_used ? 0 : plan.trialDays;
  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Confirm your plan"
        description={`${organization.displayName} · ${plan.name}, ${formatPrice(plan.priceMinor, plan.currency)} per ${plan.interval}`}
        breadcrumb={
          <Breadcrumbs
            items={[organizationCrumb(lang, organization), { label: "Billing", href: billingPath(lang, slug) }, { label: "Checkout" }]}
          />
        }
      />

      <Card as="section" aria-labelledby="terms-heading">
        <h2 id="terms-heading" className="text-h2">
          Before you continue
        </h2>
        <dl className="grid gap-3">
          {checkoutDisclosures(plan, state.trial_used).map((item) => (
            <div key={item.title} className="grid gap-0.5">
              <dt className="font-medium">{item.title}</dt>
              <dd className="text-body text-muted-foreground">{item.text}</dd>
            </div>
          ))}
        </dl>
        <p className="text-small text-muted-foreground">
          You enter your card on the page of our payment provider. CHARA never sees or stores your card details.
        </p>
      </Card>

      <CheckoutForm
        slug={slug}
        planCode={plan.code}
        termsVersion={terms.version}
        termsTitle={terms.title}
        termsPublishedAt={terms.publishedAt}
        disclosedTrialDays={trialDays}
        countries={toOptions(countries)}
        defaults={identifierDefaults(state)}
      />
    </div>
  );
}
