import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { WhereYouServeForm } from "@/components/organization/where-you-serve-form";
import { WorkforceOfferForm } from "@/components/organization/workforce-offer-form";
import { getMarketsLimit, getOrganizationGeographies } from "@/lib/dal/geographies";
import { getOrganizationProfile } from "@/lib/dal/organizations";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { getOccupationsLimit, getWorkforceOffer, workforceOfferDefaults } from "@/lib/dal/workforce-offer";
import { billingPath } from "@/lib/routes";
import { servedQuestion } from "@/lib/validation/geographies";
import { partnerTypeSchema } from "@/lib/validation/sign-up";
import { recruitmentTypeLabels, sizeBandLabels, staffingTypeLabels } from "@/lib/validation/workforce-offer";

export const metadata: Metadata = { title: "Workforce profile", robots: { index: false } };

// The workforce profile of a recruitment or staffing company: where it serves (FR-K1) and what it offers (FR-K2), changed
// after onboarding by the owner or an admin (at aal2, as on every organisation page); a member reads it. Release 2a only.
export default async function WorkforceProfilePage({ params }: PageProps<"/[lang]/org/[slug]/workforce-profile">) {
  const { lang, slug } = await params;
  if (!(await isReleased("release_partner_directories"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Workforce profile" subject="details" />;
  const partnerType = partnerTypeSchema.parse(organization.type);
  const [geographies, marketsLimit, profile, countries, offer, occupationsLimit, occupations, industries, languages] =
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
    </div>
  );
}
