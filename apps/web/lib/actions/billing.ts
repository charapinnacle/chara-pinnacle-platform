"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestHostedSession, type HostedSession } from "@/lib/dal/billing";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { billingPath, mfaPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { BILLING_FAILURE, checkoutInputSchema, legalEntityFormSchema, type CheckoutInput, type LegalEntityFormInput } from "@/lib/validation/billing";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

type BillingResult = { errors?: FieldErrors; message?: string };

const REASONS: Record<string, string> = {
  organization_suspended: "This organization is suspended, so it cannot start a subscription.",
  unknown_plan: "This plan cannot be bought online.",
  plan_not_sold: "This plan cannot be bought online.",
  terms_not_published: "The Subscription and Billing Terms are not available yet. Try again later.",
  terms_version_mismatch: "The Subscription and Billing Terms changed. Reload this page to read the current version.",
  trial_changed: "The free trial that applies to your company changed. Read the updated terms above, accept them again and continue.",
  already_subscribed: "Your organization already has a subscription. Use Manage billing to change it.",
  no_customer: "There is no billing account to manage yet.",
};

const FIELD_ERRORS: Record<string, FieldErrors> = {
  billing_country: { billingCountry: "Choose the billing country." },
  vat_id: { vatId: "Check the VAT ID." },
  registration_number: { registrationNumber: "Check the company registration number." },
  identifier: {
    vatId: "Enter a VAT ID or a company registration number.",
    registrationNumber: "Enter a VAT ID or a company registration number.",
  },
};

// A refused session is told apart by the function's reason: a lapsed second step sends the person to confirm it again,
// the rest is said in words. A failure of the provider or the network says only that nothing was charged.
function refusalResult(session: Extract<HostedSession, { refusal: object }>, slug: string): BillingResult {
  const { status, reason, field } = session.refusal;
  if (status === 401 || reason === "aal2_required") redirect(mfaPath(defaultLocale, billingPath(defaultLocale, slug)));
  if (reason && REASONS[reason]) return { message: REASONS[reason] };
  if (status === 400 && field && FIELD_ERRORS[field]) return { errors: FIELD_ERRORS[field] };
  if (reason === "legal_entity_identifier_required") return { errors: FIELD_ERRORS.identifier };
  return { message: BILLING_FAILURE };
}

export async function startCheckout(input: CheckoutInput): Promise<BillingResult | undefined> {
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { slug, ...fields } = parsed.data;
  const { organization } = await requireOrgRole(defaultLocale, slug, "admin");

  const session = await requestHostedSession({
    action: "checkout",
    orgId: organization.id,
    planCode: fields.planCode,
    billingCountry: fields.billingCountry,
    vatId: fields.vatId || null,
    registrationNumber: fields.registrationNumber || null,
    termsVersion: fields.termsVersion,
    disclosedTrialDays: fields.disclosedTrialDays,
  });
  if ("url" in session) redirect(session.url);
  // The function has saved the submitted tax data, so the page now shows the disclosures that apply to it.
  if (session.refusal.reason === "trial_changed") revalidatePath(`${billingPath(defaultLocale, slug)}/checkout`);
  return refusalResult(session, slug);
}

export async function openPortal(slug: string): Promise<BillingResult | undefined> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { message: BILLING_FAILURE };
  const { organization } = await requireOrgRole(defaultLocale, parsed.data, "admin");

  const session = await requestHostedSession({ action: "portal", orgId: organization.id });
  if ("url" in session) redirect(session.url);
  return refusalResult(session, parsed.data);
}

const IDENTIFIER_REFUSALS: Record<string, string> = {
  legal_entity_identifier_locked: "The identifier cannot be changed once a payment has been started for the company.",
  organization_suspended: "This organization is suspended, so its identifier cannot be changed.",
};

function identifierRefusal(error: PostgrestError, slug: string): BillingResult {
  if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") {
    redirect(mfaPath(defaultLocale, billingPath(defaultLocale, slug)));
  }
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "legal_entity_identifier") {
    return { errors: { identifier: "Check the identifier." } };
  }
  const known = error.details ? IDENTIFIER_REFUSALS[error.details] : undefined;
  if (known) return { message: known };
  console.error("Setting the identifier failed", { code: error.code, message: error.message });
  return { message: "We could not save the identifier. Try again." };
}

export async function saveLegalEntityIdentifier(slug: string, input: LegalEntityFormInput): Promise<BillingResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsed = legalEntityFormSchema.safeParse(input);
  if (!parsedSlug.success) return { message: "We could not save the identifier. Try again." };
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "owner");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_legal_entity_identifier", {
    p_org: organization.id,
    p_identifier: parsed.data.identifier,
    p_kind: parsed.data.identifierKind,
  });
  if (error) return identifierRefusal(error, parsedSlug.data);
  revalidatePath(billingPath(defaultLocale, parsedSlug.data));
  return {};
}
