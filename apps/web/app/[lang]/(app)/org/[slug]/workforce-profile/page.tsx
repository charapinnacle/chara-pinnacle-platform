import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { AvailabilitySection } from "@/components/organization/availability-section";
import { LicencesSection } from "@/components/organization/licences-section";
import { WhereYouServeForm } from "@/components/organization/where-you-serve-form";
import { WorkforceOfferForm } from "@/components/organization/workforce-offer-form";
import { getCommitmentStatus } from "@/lib/dal/commitment";
import { getMarketsLimit, getOrganizationGeographies } from "@/lib/dal/geographies";
import { getLicenceSettings, getPartnerLicences } from "@/lib/dal/licences";
import { getOrganizationProfile } from "@/lib/dal/organizations";
import { formatCount } from "@/lib/i18n/format";
import { getCountries, getIndustries, getLanguages, getOccupations, type ReferenceItem } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { getAvailabilityRules, getListingsLimit, getWorkforceListings } from "@/lib/dal/workforce-availability";
import { getOccupationsLimit, getWorkforceOffer, workforceOfferDefaults } from "@/lib/dal/workforce-offer";
import { billingPath, onboardingPath } from "@/lib/routes";
import { commitmentOutdated } from "@/lib/validation/commitment";
import { servedQuestion } from "@/lib/validation/geographies";
import { LICENCE_STAFF_ONLY } from "@/lib/validation/licences";
import { partnerTypeSchema } from "@/lib/validation/sign-up";
import type { AvailabilityRules } from "@/lib/validation/workforce-availability";
import { recruitmentTypeLabels, sizeBandLabels, staffingTypeLabels } from "@/lib/validation/workforce-offer";

export const metadata: Metadata = { title: "Workforce profile", robots: { index: false } };

// The employer-pays commitment of the partner is not accepted in its current version (FR-J3): a new version was published
// or the ownership changed. The owner is led to the Commitments step; everyone else is told that only the owner can
// accept, and what waits on it.
function CommitmentNotice({ lang, owner, outdated }: { lang: string; owner: boolean; outdated: boolean }) {
  return (
    <Notice tone="warning" role="status">
      {owner ? (
        <p>
          {outdated
            ? "The employer-pays commitment has changed. Accept the updated version so that your company can keep responding to job orders and submitting candidates."
            : "Accept the employer-pays commitment before your company can respond to job orders or submit candidates."}{" "}
          <TextLink href={onboardingPath(lang)}>Review and accept the commitment</TextLink>
        </p>
      ) : (
        <p>
          {outdated
            ? "Your owner needs to accept the updated commitment before you can respond to job orders or submit candidates."
            : "Your owner needs to accept the employer-pays commitment before you can respond to job orders or submit candidates."}
        </p>
      )}
    </Notice>
  );
}

// The licences are read in their own boundary, so the rest of the page does not wait for them.
async function Licences({
  organizationId,
  slug,
  canManage,
  countries,
}: {
  organizationId: string;
  slug: string;
  canManage: boolean;
  countries: ReferenceItem[];
}) {
  const [licences, { patterns, maxYears }] = await Promise.all([getPartnerLicences(organizationId), getLicenceSettings()]);
  return (
    <LicencesSection
      slug={slug}
      canManage={canManage}
      licences={licences}
      countries={countries}
      patterns={patterns}
      maxYears={maxYears}
    />
  );
}

// The availability listings are read in their own boundary too; a listing names one of the occupations and one of the
// source countries of the profile above.
async function Availability({
  organizationId,
  slug,
  canManage,
  occupations,
  countries,
  rules,
  billingHref,
}: {
  organizationId: string;
  slug: string;
  canManage: boolean;
  occupations: ReferenceItem[];
  countries: ReferenceItem[];
  rules: AvailabilityRules;
  billingHref: string;
}) {
  const [listings, limit] = await Promise.all([getWorkforceListings(organizationId), getListingsLimit(organizationId)]);
  return (
    <AvailabilitySection
      slug={slug}
      canManage={canManage}
      listings={listings}
      occupations={occupations}
      countries={countries}
      rules={rules}
      limit={limit}
      billingHref={billingHref}
      now={new Date().toISOString()}
    />
  );
}

// The workforce profile of a recruitment or staffing company: where it serves (FR-K1) and what it offers (FR-K2), changed
// after onboarding by the owner or an admin (at aal2, as on every organisation page); a member reads it. The licences it
// holds per country (FR-J2) are recorded here too, for staff only, and the workforce it can supply (FR-K3). Release 2a
// only.
export default async function WorkforceProfilePage({ params }: PageProps<"/[lang]/org/[slug]/workforce-profile">) {
  const { lang, slug } = await params;
  if (!(await isReleased("release_partner_directories"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Workforce profile" subject="details" />;
  const partnerType = partnerTypeSchema.parse(organization.type);
  const [
    geographies,
    marketsLimit,
    profile,
    countries,
    offer,
    occupationsLimit,
    occupations,
    industries,
    languages,
    commitment,
    availabilityRules,
  ] =
    await Promise.all([
      getOrganizationGeographies(organization.id),
      getMarketsLimit(organization.id),
      getOrganizationProfile(organization.id),
      getCountries(),
      getWorkforceOffer(organization.id),
      getOccupationsLimit(organization.id),
      getOccupations(),
      getIndustries(),
      getLanguages(),
      getCommitmentStatus(organization.id),
      getAvailabilityRules(),
    ]);
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;
  const basedIn = profile ? nameOf(profile.country) : "";
  const named = (items: readonly { code: string; name: string }[], codes: string[]) =>
    codes.map((code) => items.find((item) => item.code === code)?.name ?? code);
  const offerTerms = [
    {
      term: "Occupations",
      values: offer.occupations.map((code) => occupations.find((item) => item.code === code)?.label ?? code),
    },
    { term: "Industries", values: named(industries, offer.industries) },
    { term: "Languages", values: named(languages, offer.languages) },
    { term: "Recruitment type", values: offer.recruitmentType ? [recruitmentTypeLabels[offer.recruitmentType]] : [] },
    {
      term: "Staffing types",
      values: offer.serviceTypes.flatMap((service) => (service === "staffing" ? [] : [staffingTypeLabels[service]])),
    },
    { term: "Company size", values: offer.sizeBand ? [sizeBandLabels[offer.sizeBand]] : [] },
    { term: "Year founded", values: offer.foundedYear === null ? [] : [String(offer.foundedYear)] },
  ];

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Workforce profile"
        description="Employers and job orders reach you through the countries where you serve and what you offer. Once your company is listed, everyone can see them on your profile."
        breadcrumb={<Breadcrumbs items={[{ label: organization.displayName }, { label: "Workforce profile" }]} />}
      />
      {commitment.accepted ? null : (
        <CommitmentNotice lang={lang} owner={organization.role === "owner"} outdated={commitmentOutdated(commitment)} />
      )}
      <section aria-labelledby="where-you-serve-heading" className="grid gap-6">
        <h2 id="where-you-serve-heading" className="text-h2">
          Where you serve
        </h2>
        {organization.role === "member" ? (
          <dl className="grid gap-4">
            {[
              { term: "Where are you based?", codes: profile ? [profile.country] : [] },
              { term: "Where do you source workers from?", codes: geographies.sourcesFrom },
              { term: servedQuestion[partnerType], codes: geographies.servesMarket },
            ].map(({ term, codes }) => (
              <div key={term} className="grid gap-1">
                <dt className="text-small font-semibold">{term}</dt>
                <dd className="text-body">{codes.length === 0 ? "No countries chosen yet." : codes.map(nameOf).join(", ")}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <WhereYouServeForm
            slug={slug}
            partnerType={partnerType}
            basedIn={basedIn}
            countries={countries}
            defaults={geographies}
            marketsLimit={marketsLimit}
            billingHref={billingPath(lang, slug)}
            onboarding={false}
          />
        )}
      </section>
      <section aria-labelledby="what-you-offer-heading" className="grid gap-6">
        <h2 id="what-you-offer-heading" className="text-h2">
          What you offer
        </h2>
        {organization.role === "member" ? (
          <dl className="grid gap-4">
            {offerTerms.map(({ term, values }) => (
              <div key={term} className="grid gap-1">
                <dt className="text-small font-semibold">{term}</dt>
                <dd className="text-body">{values.length === 0 ? "Not given yet." : values.join(", ")}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <WorkforceOfferForm
            slug={slug}
            partnerType={partnerType}
            occupations={occupations}
            industries={industries}
            languages={languages}
            defaults={workforceOfferDefaults(offer)}
            occupationsLimit={occupationsLimit}
            billingHref={billingPath(lang, slug)}
            onboarding={false}
          />
        )}
      </section>
      <section aria-labelledby="availability-heading" className="grid gap-6">
        <div className="grid gap-2">
          <h2 id="availability-heading" className="text-h2">
            Availability
          </h2>
          <p className="text-body text-muted-foreground">
            The workers you can supply per occupation and source country. Once your company is listed, signed-in companies
            see each listing confirmed within the last {formatCount(availabilityRules.staleDays)} days.
          </p>
        </div>
        <Suspense fallback={<LoadingSkeleton rows={2} />}>
          <Availability
            organizationId={organization.id}
            slug={slug}
            canManage={organization.role !== "member"}
            occupations={offer.occupations.map((code) => ({
              code,
              name: occupations.find((item) => item.code === code)?.label ?? code,
            }))}
            countries={geographies.sourcesFrom.map((code) => ({ code, name: nameOf(code) }))}
            rules={availabilityRules}
            billingHref={billingPath(lang, slug)}
          />
        </Suspense>
      </section>
      <section aria-labelledby="licences-heading" className="grid gap-6">
        <div className="grid gap-2">
          <h2 id="licences-heading" className="text-h2">
            Licences
          </h2>
          <p className="text-body text-muted-foreground">
            The licence or registration you hold for each country where you recruit or supply workers. {LICENCE_STAFF_ONLY}.
          </p>
        </div>
        <Suspense fallback={<LoadingSkeleton rows={2} />}>
          <Licences
            organizationId={organization.id}
            slug={slug}
            canManage={organization.role !== "member"}
            countries={countries}
          />
        </Suspense>
      </section>
    </div>
  );
}
