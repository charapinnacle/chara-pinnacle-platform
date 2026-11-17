import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalEntityForm } from "@/components/billing/legal-entity-form";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { CompanyPageSwitch } from "@/components/organization/company-page-switch";
import { ProfileForm } from "@/components/organization/profile-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getBillingState } from "@/lib/dal/billing";
import { followerCountText } from "@/lib/connections/access";
import { getCompanyPageEnabled } from "@/lib/dal/company-page";
import { getFollowerCount } from "@/lib/dal/connections";
import { getOrganizationProfile } from "@/lib/dal/organizations";
import { getPartnerReview } from "@/lib/dal/partner-review";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { billingPath, companyPagePath } from "@/lib/routes";
import { identifierKindLabels } from "@/lib/validation/organization";

export const metadata: Metadata = { title: "Company profile", robots: { index: false } };

// The company details an owner or admin entered at registration (FR-A2, FR-J1), at aal2 like every other page that changes
// the organisation. An employer's identifier is shown only: the owner records it on the billing page, where it decides the
// trial, and the same lock applies to it and to the legal name. A recruitment or staffing company keeps its details here
// once onboarding is over (release 2a only), and its owner corrects the identifier here too: a change of the legal name or
// the identifier of a listed company returns it to review (FR-J4 AC9, the trigger organizations_return_to_review), a
// change of the display name, website or description does not.
export default async function OrganizationProfilePage({ params }: PageProps<"/[lang]/org/[slug]/profile">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "admin", { hideFromOutsiders: true, partner: "either" });
  const partner = organization.type !== "employer";
  if (partner && !(await isReleased("release_partner_directories"))) notFound();
  if (organization.suspended) return <SuspendedOrganization title="Company profile" subject="details" />;
  const [profile, billing, countries, industries, companyPageReleased, review] = await Promise.all([
    getOrganizationProfile(organization.id),
    getBillingState(organization.id),
    getCountries(),
    getIndustries(),
    isReleased("release_partner_directories"),
    partner ? getPartnerReview(organization.id) : null,
  ]);
  // The switch of the public company page of an employer (FR-K5) belongs to release 2a and stays hidden until it is on.
  const [companyPageEnabled, followers] = companyPageReleased && !partner
    ? await Promise.all([getCompanyPageEnabled(organization.id), getFollowerCount(organization.id)])
    : [null, null];
  if (!profile) notFound();
  const identifier = billing.identifier
    ? `${identifierKindLabels[billing.identifier_kind ?? ""] ?? "Identifier"}: ${billing.identifier}.`
    : "No company registration number or VAT number is recorded yet.";
  const listed = review !== null && review.listedAt !== null && review.status !== "declined";
  const owner = organization.role === "owner";

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Company profile"
        description={
          partner
            ? "Employers see the display name, website and description on your profile. The legal name is not shown."
            : "Candidates see the display name, country, industry and website on your vacancies. The legal name is not shown."
        }
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Company profile" }]} />}
      />
      {listed ? (
        <Notice tone="info">
          Changing the legal name or the company identifier sends {organization.displayName} back to review; it stays listed
          until our team has decided. The display name, website and description change at once.
        </Notice>
      ) : null}
      <ProfileForm
        slug={slug}
        defaults={profile}
        legalNameLocked={billing.identifier_locked}
        countries={countries}
        industries={industries}
        partner={partner}
      />
      {companyPageEnabled !== null ? (
        <section aria-labelledby="company-page-heading" className="grid gap-3">
          <h2 id="company-page-heading" className="text-h2">
            Company page
          </h2>
          <CompanyPageSwitch slug={slug} enabled={companyPageEnabled} pageHref={companyPagePath(lang, slug)} />
          {followers ? (
            <p className="text-body text-muted-foreground">
              {followerCountText(followers)}. Only the number is shown: no one sees who follows your company.
            </p>
          ) : null}
        </section>
      ) : null}
      <section aria-labelledby="identifier-heading" className="grid gap-2">
        <h2 id="identifier-heading" className="text-h2">
          Company identifier
        </h2>
        <p className="text-body text-muted-foreground">
          {identifier}{" "}
          {billing.identifier_locked
            ? "It cannot be changed once a payment has been started for the company."
            : partner
              ? owner
                ? "You correct it here."
                : "The owner corrects it on this page."
              : owner
                ? "You record or correct it on the billing page."
                : "The owner records or corrects it on the billing page."}
        </p>
        {!billing.identifier_locked && owner && partner ? (
          <LegalEntityForm
            slug={slug}
            defaults={{ identifier: billing.identifier ?? "", identifierKind: billing.identifier_kind ?? "" }}
          />
        ) : null}
        {!billing.identifier_locked && owner && !partner ? (
          <TextLink standalone href={billingPath(lang, slug)}>
            Go to billing
          </TextLink>
        ) : null}
      </section>
    </div>
  );
}
