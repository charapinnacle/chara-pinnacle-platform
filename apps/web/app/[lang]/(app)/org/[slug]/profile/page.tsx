import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { ProfileForm } from "@/components/organization/profile-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getBillingState } from "@/lib/dal/billing";
import { getOrganizationProfile } from "@/lib/dal/organizations";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { requireOrgRole } from "@/lib/dal/session";
import { billingPath } from "@/lib/routes";
import { identifierKindLabels } from "@/lib/validation/organization";

export const metadata: Metadata = { title: "Company profile — CHARA", robots: { index: false } };

// The company details an owner or admin entered at registration (FR-A2), at aal2 like every other page that changes the
// organisation. The legal-entity identifier is shown only: the owner records it on the billing page, where it decides the
// trial, and the same lock applies to it and to the legal name.
export default async function OrganizationProfilePage({ params }: PageProps<"/[lang]/org/[slug]/profile">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "admin", { hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization title="Company profile" subject="details" />;
  const [profile, billing, countries, industries] = await Promise.all([
    getOrganizationProfile(organization.id),
    getBillingState(organization.id),
    getCountries(),
    getIndustries(),
  ]);
  if (!profile) notFound();
  const identifier = billing.identifier
    ? `${identifierKindLabels[billing.identifier_kind ?? ""] ?? "Identifier"}: ${billing.identifier}.`
    : "No company registration number or VAT number is recorded yet.";

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Company profile"
        description="Candidates see the display name, country, industry and website on your vacancies. The legal name is not shown."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Company profile" }]} />}
      />
      <ProfileForm
        slug={slug}
        defaults={profile}
        legalNameLocked={billing.identifier_locked}
        countries={countries}
        industries={industries}
      />
      <section aria-labelledby="identifier-heading" className="grid gap-2">
        <h2 id="identifier-heading" className="text-h2">
          Company identifier
        </h2>
        <p className="text-body text-muted-foreground">
          {identifier}{" "}
          {billing.identifier_locked
            ? "It cannot be changed once a payment has been started for the company."
            : organization.role === "owner"
              ? "You record or correct it on the billing page."
              : "The owner records or corrects it on the billing page."}
        </p>
        {!billing.identifier_locked && organization.role === "owner" ? (
          <TextLink standalone href={billingPath(lang, slug)}>
            Go to billing
          </TextLink>
        ) : null}
      </section>
    </div>
  );
}
