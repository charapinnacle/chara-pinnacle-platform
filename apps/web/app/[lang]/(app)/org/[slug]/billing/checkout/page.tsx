import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CheckoutForm } from "@/components/billing/checkout-form";
import { TextLink } from "@/components/forms/text-link";
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
    state.identifier && state.identifierKind && kinds.includes(state.identifierKind) ? state.identifier : "";
  return {
    billingCountry: state.billingCountry ?? "",
    vatId: state.vatId ?? fromKind(["vat_number"]),
    registrationNumber: state.registrationNumber ?? fromKind(["registration_number", "other"]),
  };
}

export default async function CheckoutPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/billing/checkout">) {
  const [{ lang, slug }, { plan: planParam }] = await Promise.all([params, searchParams]);
  const { organization } = await requireOrgRole(lang, slug, "admin");
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

  const trialDays = state.trialUsed ? 0 : plan.trialDays;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Confirm your plan</h1>
        <p className="text-body text-muted-foreground">
          {organization.displayName} · {plan.name}, {formatPrice(plan.priceMinor, plan.currency)} per {plan.interval}
        </p>
      </header>

      <section aria-labelledby="terms-heading" className="grid gap-3 rounded-xl border bg-card p-4">
        <h2 id="terms-heading" className="text-lg font-semibold">
          Before you continue
        </h2>
        <dl className="grid gap-3">
          {checkoutDisclosures(plan, state.trialUsed).map((item) => (
            <div key={item.title} className="grid gap-0.5">
              <dt className="font-medium">{item.title}</dt>
              <dd className="text-body text-muted-foreground">{item.text}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          You enter your card on the page of our payment provider. CHARA never sees or stores your card details.
        </p>
      </section>

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
      <TextLink standalone href={billingPath(lang, slug)}>
        Back to billing
      </TextLink>
    </div>
  );
}
