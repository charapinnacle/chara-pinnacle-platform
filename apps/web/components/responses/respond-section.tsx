import { redirect } from "next/navigation";
import { EligibilityPanel } from "@/components/responses/eligibility-panel";
import { ResponseForm } from "@/components/responses/response-form";
import type { OrganizationType, UsagePrompt } from "@/lib/billing/limits";
import { getCommitmentBlock } from "@/lib/dal/commitment";
import { getCountries, getCurrencies } from "@/lib/dal/reference";
import { getResponseDocumentsMax, listResponseDocuments, type ResponseEligibility } from "@/lib/dal/responses";
import { getUsagePrompts } from "@/lib/dal/usage";
import { RESPONSE_LIMIT_KEY } from "@/lib/responses/refusal";
import { billingPath, responsePath } from "@/lib/routes";
import type { CommitmentBlock } from "@/lib/validation/commitment";

type Organization = { id: string; type: OrganizationType; role: "owner" | "admin" | "member" };

// The upgrade prompt of the monthly limit when that is what stops the partner (V13); null otherwise or when it cannot
// be read, and the panel then says the limit in words.
export async function limitPromptFor(organization: Organization, eligibility: ResponseEligibility): Promise<UsagePrompt | null> {
  if (eligibility.refusal !== "CHARA_LIMIT_REACHED") return null;
  const prompts = await getUsagePrompts(organization.id, organization.type, [RESPONSE_LIMIT_KEY]).catch(() => null);
  return prompts?.[RESPONSE_LIMIT_KEY] ?? null;
}

// The commitment as the owner accepts it when an outdated or missing acceptance is what stops the partner (FR-J3 AC4);
// null otherwise or when it cannot be read, and the panel then says the reason without the dialog.
export async function commitmentBlockFor(organizationId: string, eligibility: ResponseEligibility): Promise<CommitmentBlock | null> {
  if (eligibility.refusal !== "CHARA_CONSENT_REQUIRED") return null;
  return getCommitmentBlock(organizationId).catch(() => null);
}

type RespondSectionProps = {
  lang: string;
  slug: string;
  organization: Organization;
  requirement: { id: string; workersNeeded: number; countryCode: string; salaryCurrency: string | null };
  eligibility: ResponseEligibility;
  // This page, which the panel's Respond would lead to.
  selfHref: string;
};

// The body of the response form's pages (from a job order and from an invitation): a partner that already responded is
// sent to its response (one response per job order); one that cannot respond now reads the panel with the missing
// condition; otherwise the form, with the files it staged earlier for this requirement.
export async function RespondSection({ lang, slug, organization, requirement, eligibility, selfHref }: RespondSectionProps) {
  if (eligibility.responseId) redirect(responsePath(lang, slug, eligibility.responseId));
  const canManage = organization.role !== "member";
  if (!eligibility.canRespond || eligibility.maxCapacity === null) {
    const [countries, limitPrompt, commitment] = await Promise.all([
      getCountries(),
      limitPromptFor(organization, eligibility),
      commitmentBlockFor(organization.id, eligibility),
    ]);
    const countryName = (code: string) => countries.find((country) => country.code === code)?.name ?? code;
    return (
      <EligibilityPanel
        lang={lang}
        slug={slug}
        organization={{ id: organization.id, type: organization.type, canManage, owner: organization.role === "owner" }}
        eligibility={eligibility}
        countryName={countryName}
        destinationName={countryName(requirement.countryCode)}
        respondHref={selfHref}
        limitPrompt={limitPrompt}
        commitment={commitment}
      />
    );
  }
  const [currencies, documents, documentsMax] = await Promise.all([
    getCurrencies(),
    listResponseDocuments({ organizationId: organization.id, requirementId: requirement.id }),
    getResponseDocumentsMax(),
  ]);
  return (
    <ResponseForm
      lang={lang}
      slug={slug}
      requirementId={requirement.id}
      workersNeeded={requirement.workersNeeded}
      maxCapacity={eligibility.maxCapacity}
      currencies={currencies}
      defaultCurrency={requirement.salaryCurrency}
      documents={documents}
      documentsMax={documentsMax}
      organization={{ id: organization.id, type: organization.type, canManage }}
      billingHref={billingPath(lang, slug)}
    />
  );
}
