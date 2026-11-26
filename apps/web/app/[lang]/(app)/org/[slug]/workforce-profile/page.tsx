import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { AvailabilitySection } from "@/components/organization/availability-section";
import { CommitmentGate } from "@/components/organization/commitment-gate";
import { LicencesSection } from "@/components/organization/licences-section";
import { StandardTermsForm, TrackRecordForm } from "@/components/organization/terms-and-record-forms";
import { ModerationNotice } from "@/components/organization/moderation-notice";
import { WhereYouServeForm } from "@/components/organization/where-you-serve-form";
import { WorkforceOfferForm } from "@/components/organization/workforce-offer-form";
import { getCommitmentBlock } from "@/lib/dal/commitment";
import { getOrganizationGeographies } from "@/lib/dal/geographies";
import { getLicenceSettings, getPartnerLicences } from "@/lib/dal/licences";
import { getOrganizationProfile } from "@/lib/dal/organizations";
import { listMyAppeals } from "@/lib/dal/appeals";
import { getPartnerProfileModeration } from "@/lib/dal/partner-profile";
import { formatCount } from "@/lib/i18n/format";
import { getCountries, getCurrencies, getIndustries, getLanguages, getOccupations, type ReferenceItem } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { getUnenforcedAllowances, getUsagePrompts } from "@/lib/dal/usage";
import { getAvailabilityRules, getListingCounts, getWorkforceListings } from "@/lib/dal/workforce-availability";
import { getPartnerKind, getWorkforceOffer, workforceOfferDefaults } from "@/lib/dal/workforce-offer";
import { getOwnStandardTerms, getOwnTrackRecord, getPublicTermsAndRecord } from "@/lib/dal/partner-terms";
import { standardTermsLines, trackRecordLines } from "@/lib/partners/terms-and-record";
import { billingPath, workforceProfilePath, workforceProfilePreviewPath } from "@/lib/routes";
import { servedQuestion } from "@/lib/validation/geographies";
import { LICENCE_STAFF_ONLY } from "@/lib/validation/licences";
import { partnerTypeSchema, type PartnerType } from "@/lib/validation/sign-up";
import type { AvailabilityRules } from "@/lib/validation/workforce-availability";
import { recruitmentTypeLabels, sizeBandLabels, staffingTypeLabels } from "@/lib/validation/workforce-offer";

export const metadata: Metadata = { title: "Workforce profile", robots: { index: false } };

// The licences are read in their own boundary, so the rest of the page does not wait for them.
async function Licences({
  organizationId,
  slug,
  canManage,
  countries,
  initialCountry,
  profilePath,
}: {
  organizationId: string;
  slug: string;
  canManage: boolean;
  countries: ReferenceItem[];
  initialCountry: string | null;
  profilePath: string;
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
      initialCountry={initialCountry}
      profilePath={profilePath}
      key={initialCountry ?? ""}
    />
  );
}

function Lines({ lines, empty }: { lines: string[]; empty: string }) {
  if (lines.length === 0) return <p className="text-body text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-1 text-body">
      {lines.map((line) => (
        <li key={line} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

// The standard terms, read in their own boundary with the currencies and the fee models of the company's kind; a member
// reads them without the form.
async function StandardTerms({
  organization,
  slug,
  canManage,
}: {
  organization: { id: string; type: string };
  slug: string;
  canManage: boolean;
}) {
  const [terms, currencies, kind] = await Promise.all([
    getOwnStandardTerms(organization.id),
    getCurrencies(),
    getPartnerKind(organization),
  ]);
  if (!canManage) return <Lines lines={terms ? standardTermsLines(terms) : []} empty="No standard terms stated" />;
  return <StandardTermsForm slug={slug} kind={kind} terms={terms} currencies={currencies} />;
}

// The stated track record, with the hires counted on the platform, which the company cannot change.
async function TrackRecord({
  organizationId,
  slug,
  countries,
  canManage,
}: {
  organizationId: string;
  slug: string;
  countries: ReferenceItem[];
  canManage: boolean;
}) {
  const [record, counted] = await Promise.all([getOwnTrackRecord(organizationId), getPublicTermsAndRecord(slug)]);
  return (
    <div className="grid gap-4">
      <p className="text-body">
        <span className="font-semibold">Hires through Chara Pinnacle: {formatCount(counted?.record.platformHires ?? 0)}</span>{" "}
        <span className="text-muted-foreground">(counted by Chara Pinnacle from the responses employers selected)</span>
      </p>
      {canManage ? (
        <TrackRecordForm slug={slug} placementsLastYear={record.placementsLastYear} countriesPlaced={record.countriesPlaced} countries={countries} />
      ) : (
        <Lines lines={counted ? trackRecordLines(counted.record) : []} empty="No track record stated" />
      )}
    </div>
  );
}

// The availability listings are read in their own boundary too; a listing names one of the occupations and one of the
// source countries of the profile above.
async function Availability({
  organizationId,
  partnerType,
  slug,
  canManage,
  occupations,
  countries,
  languages,
  rules,
  billingHref,
}: {
  organizationId: string;
  partnerType: PartnerType;
  slug: string;
  canManage: boolean;
  occupations: ReferenceItem[];
  countries: ReferenceItem[];
  languages: ReferenceItem[];
  rules: AvailabilityRules;
  billingHref: string;
}) {
  const [listings, prompts] = await Promise.all([
    getWorkforceListings(organizationId),
    getUsagePrompts(organizationId, partnerType, ["workforce_listings"]),
  ]);
  return (
    <AvailabilitySection
      slug={slug}
      organizationId={organizationId}
      partnerType={partnerType}
      canManage={canManage}
      listings={listings}
      occupations={occupations}
      languages={languages}
      countries={countries}
      rules={rules}
      prompt={prompts.workforce_listings}
      billingHref={billingHref}
      now={new Date().toISOString()}
    />
  );
}

// The workforce profile of a recruitment or staffing company: where it serves (FR-K1) and what it offers (FR-K2), changed
// after onboarding by the owner or an admin (at aal2, as on every organisation page); a member reads it. The licences it
// holds per country (FR-J2) are recorded here too, for staff only, and the workforce it can supply (FR-K3). Release 2a
// only. ?licence=<country> opens the licence form for that country (the prompt after saving Where you serve, FR-K1 AC8).
export default async function WorkforceProfilePage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/workforce-profile">) {
  const [{ lang, slug }, { licence }] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Workforce profile" subject="details" />;
  const partnerType = partnerTypeSchema.parse(organization.type);
  const [
    geographies,
    prompts,
    profile,
    countries,
    offer,
    occupations,
    industries,
    languages,
    commitment,
    availabilityRules,
    moderation,
    allowances,
  ] =
    await Promise.all([
      getOrganizationGeographies(organization.id),
      getUsagePrompts(organization.id, partnerType, ["markets", "listed_occupations"]),
      getOrganizationProfile(organization.id),
      getCountries(),
      getWorkforceOffer(organization.id),
      getOccupations(),
      getIndustries(),
      getLanguages(),
      getCommitmentBlock(organization.id),
      getAvailabilityRules(),
      getPartnerProfileModeration(organization.id),
      getUnenforcedAllowances(organization.id, ["markets"]),
    ]);
  const appeal = moderation.decision ? await listMyAppeals(moderation.decision.id) : null;
  const billingHref = billingPath(lang, slug);
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;
  // Not awaited: the profile forms show the warning about listings once the counts arrive.
  const listingCounts = organization.role === "member" ? null : getListingCounts(organization.id);
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
      >
        <TextLink standalone href={workforceProfilePreviewPath(lang, slug)}>
          Preview your public profile
        </TextLink>
      </PageHeader>
      <ModerationNotice lang={lang} moderation={moderation} appeal={appeal} />
      {commitment ? (
        <CommitmentGate slug={slug} owner={organization.role === "owner"} commitment={commitment} reasonId="commitment-reason" />
      ) : null}
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
            organizationId={organization.id}
            partnerType={partnerType}
            basedIn={basedIn}
            countries={countries}
            defaults={geographies}
            marketsPrompt={prompts.markets}
            marketsAllowance={allowances.markets}
            billingHref={billingHref}
            onboarding={false}
            listingCounts={listingCounts?.then((counts) => counts.countries)}
            profilePath={workforceProfilePath(lang, slug)}
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
            organizationId={organization.id}
            partnerType={partnerType}
            occupations={occupations}
            industries={industries}
            languages={languages}
            defaults={workforceOfferDefaults(offer)}
            occupationsPrompt={prompts.listed_occupations}
            billingHref={billingHref}
            onboarding={false}
            listingCounts={listingCounts?.then((counts) => counts.occupations)}
          />
        )}
      </section>
      <section aria-labelledby="availability-heading" className="grid gap-6">
        <div className="grid gap-2">
          <h2 id="availability-heading" className="text-h2">
            {partnerType === "recruitment_company" ? "Recruiting capacity" : "Available workforce"}
          </h2>
          <p className="text-body text-muted-foreground">
            {partnerType === "recruitment_company"
              ? "The candidates you can put forward and recruit per occupation and source country."
              : "The workers on your payroll you can supply per occupation and source country."}{" "}
            Once your company is listed, signed-in users see each listing confirmed within the last{" "}
            {formatCount(availabilityRules.staleDays)} days.
          </p>
        </div>
        <Suspense fallback={<LoadingSkeleton rows={2} />}>
          <Availability
            organizationId={organization.id}
            partnerType={partnerType}
            slug={slug}
            canManage={organization.role !== "member"}
            occupations={offer.occupations.map((code) => ({
              code,
              name: occupations.find((item) => item.code === code)?.label ?? code,
            }))}
            countries={geographies.sourcesFrom.map((code) => ({ code, name: nameOf(code) }))}
            languages={languages}
            rules={availabilityRules}
            billingHref={billingHref}
          />
        </Suspense>
      </section>
      <section aria-labelledby="terms-heading" className="grid gap-6">
        <div className="grid gap-2">
          <h2 id="terms-heading" className="text-h2">
            Standard terms
          </h2>
          <p className="text-body text-muted-foreground">
            The fee you usually charge, shown on your public profile so employers can compare. Your response to a job order still
            states the fee for that job order.
          </p>
        </div>
        <Suspense fallback={<LoadingSkeleton rows={2} />}>
          <StandardTerms organization={organization} slug={slug} canManage={organization.role !== "member"} />
        </Suspense>
      </section>
      <section aria-labelledby="track-record-heading" className="grid gap-6">
        <div className="grid gap-2">
          <h2 id="track-record-heading" className="text-h2">
            Track record
          </h2>
          <p className="text-body text-muted-foreground">
            What your company has done so far. Your public profile shows these as stated by your company, next to the hires
            counted by Chara Pinnacle.
          </p>
        </div>
        <Suspense fallback={<LoadingSkeleton rows={2} />}>
          <TrackRecord organizationId={organization.id} slug={slug} countries={countries} canManage={organization.role !== "member"} />
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
            initialCountry={typeof licence === "string" && countries.some(({ code }) => code === licence) ? licence : null}
            profilePath={workforceProfilePath(lang, slug)}
          />
        </Suspense>
      </section>
    </div>
  );
}
