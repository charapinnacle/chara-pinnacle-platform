import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessLogSection } from "@/components/access-log/access-log-section";
import { DocumentsSection } from "@/components/documents/documents-section";
import { PageHeader } from "@/components/layout/page-header";
import { AuthorizationsSection } from "@/components/passport/authorizations-section";
import { BasicsForm } from "@/components/passport/basics-form";
import { CompletenessCard } from "@/components/passport/completeness-card";
import { ExperienceForm } from "@/components/passport/experience-form";
import { LanguagesSection } from "@/components/passport/languages-section";
import { OccupationForm } from "@/components/passport/occupation-form";
import { PreferredCountriesSection } from "@/components/passport/preferred-countries-section";
import { Section } from "@/components/layout/section";
import { SkillsSection } from "@/components/passport/skills-section";
import { hasUsableCv } from "@/lib/dal/documents";
import { getPassport, getPassportLimits } from "@/lib/dal/passport";
import { getCountries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { requireUser } from "@/lib/dal/session";
import { computeCompleteness } from "@/lib/passport/completeness";
import { homePath } from "@/lib/routes";
import { todayUtc } from "@/lib/validation/passport";

export const metadata: Metadata = { title: "Your passport — CHARA", robots: { index: false } };

export default async function PassportPage({ params }: PageProps<"/[lang]/passport">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "worker") redirect(homePath(lang, user.accountKind));

  const [passport, hasCv, limits, countries, languages, occupations] = await Promise.all([
    getPassport(user.id),
    hasUsableCv(),
    getPassportLimits(),
    getCountries(),
    getLanguages(),
    getOccupations(),
  ]);
  if (!passport) redirect(`/${lang}/onboarding`);

  return (
    <div className="grid w-full gap-section">
      <PageHeader title="Your passport" description="Only you can see your passport. Each section below is saved on its own." />

      <div className="grid items-start gap-page xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section id="completeness" title="Completeness" className="xl:sticky xl:top-24 xl:col-start-2 xl:row-start-1">
          <CompletenessCard lang={lang} completeness={computeCompleteness({ ...passport, hasCv }, todayUtc())} />
        </Section>
        <div className="grid min-w-0 gap-page xl:col-start-1 xl:row-start-1">
          <Section id="basics" title="Your details">
            <BasicsForm
              countries={countries}
              initial={{
                firstName: passport.firstName,
                lastName: passport.lastName,
                headline: passport.headline ?? "",
                country: passport.country,
              }}
            />
          </Section>
          <Section id="occupation" title="Occupation">
            <OccupationForm occupationId={passport.occupationId} occupations={occupations} />
          </Section>
          <Section id="skills" title="Skills">
            <SkillsSection skills={passport.skills} max={limits.skillsMax} />
          </Section>
          <Section id="languages" title="Languages">
            <LanguagesSection languages={passport.languages} options={languages} />
          </Section>
          <Section id="experience" title="Experience and availability">
            <ExperienceForm
              windowMonths={limits.availabilityWindowMonths}
              initial={{
                yearsExperience: passport.yearsExperience === null ? "" : String(passport.yearsExperience),
                availability: passport.availability ?? "",
                availableFrom: passport.availableFrom ?? "",
              }}
            />
          </Section>
          <Section id="preferred-countries" title="Preferred countries">
            <PreferredCountriesSection selected={passport.preferredCountries} countries={countries} />
          </Section>
          <Section
            id="authorizations"
            title="Work authorisation"
            description="The countries where you may work. Add only the country and, if there is one, the date it expires."
          >
            <AuthorizationsSection
              authorizations={passport.authorizations}
              countries={countries}
              expiryYears={limits.authorizationExpiryYears}
            />
          </Section>
          <Section
            id="documents"
            title="Documents"
            description="Upload your CV and certificates. Only you can see them: they are stored privately and you can download, rename or delete them here."
          >
            <DocumentsSection />
          </Section>
          <Section
            id="access-log"
            title="Access log"
            description="Every time an organisation opens one of your documents, it is recorded here with the date and time. If you do not recognise an entry, report it."
          >
            <AccessLogSection />
          </Section>
        </div>
      </div>
    </div>
  );
}
