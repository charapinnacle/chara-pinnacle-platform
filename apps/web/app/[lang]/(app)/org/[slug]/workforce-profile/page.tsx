import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { WhereYouServeForm } from "@/components/organization/where-you-serve-form";
import { getMarketsLimit, getOrganizationGeographies } from "@/lib/dal/geographies";
import { getOrganizationProfile } from "@/lib/dal/organizations";
import { getCountries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { billingPath } from "@/lib/routes";
import { servedQuestion } from "@/lib/validation/geographies";
import { partnerTypeSchema } from "@/lib/validation/sign-up";

export const metadata: Metadata = { title: "Workforce profile", robots: { index: false } };

// The workforce profile of a recruitment or staffing company (FR-K1): where it serves, changed after onboarding by the
// owner or an admin (at aal2, as on every organisation page); a member reads it. Release 2a only.
export default async function WorkforceProfilePage({ params }: PageProps<"/[lang]/org/[slug]/workforce-profile">) {
  const { lang, slug } = await params;
  if (!(await isReleased("release_partner_directories"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Workforce profile" subject="details" />;
  const partnerType = partnerTypeSchema.parse(organization.type);
  const [geographies, marketsLimit, profile, countries] = await Promise.all([
    getOrganizationGeographies(organization.id),
    getMarketsLimit(organization.id),
    getOrganizationProfile(organization.id),
    getCountries(),
  ]);
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;
  const basedIn = profile ? nameOf(profile.country) : "";

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Workforce profile"
        description="Employers and job orders reach you through the countries where you serve. Once your company is listed, everyone can see them on your profile."
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
    </div>
  );
}
