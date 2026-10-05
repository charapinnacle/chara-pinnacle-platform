import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { AuthorizationsSection } from "@/components/passport/authorizations-section";
import { BasicsForm } from "@/components/passport/basics-form";
import { ExperienceForm } from "@/components/passport/experience-form";
import { LanguagesSection } from "@/components/passport/languages-section";
import { OccupationForm } from "@/components/passport/occupation-form";
import { PreferredCountriesSection } from "@/components/passport/preferred-countries-section";
import { PassportSection } from "@/components/passport/section";
import { SkillsSection } from "@/components/passport/skills-section";
import { getPassport, getPassportLimits } from "@/lib/dal/passport";
import { getCountries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { requireUser } from "@/lib/dal/session";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Your passport — CHARA", robots: { index: false } };

export default async function PassportPage({ params }: PageProps<"/[lang]/passport">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "worker") redirect(homePath(lang, user.accountKind));

  const [passport, limits, countries, languages, occupations] = await Promise.all([
    getPassport(user.id),
    getPassportLimits(),
    getCountries(),
    getLanguages(),
    getOccupations(),
  ]);
  if (!passport) redirect(`/${lang}/onboarding`);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Your passport</h1>
        <p className="text-body text-muted-foreground">
          Only you can see your passport. Each section below is saved on its own.
        </p>
        <TextLink standalone href={homePath(lang, "worker")}>
          Back to the dashboard
        </TextLink>
      </header>

      <PassportSection id="basics" title="Your details">
        <BasicsForm
          countries={countries}
          initial={{
            firstName: passport.firstName,
            lastName: passport.lastName,
            headline: passport.headline ?? "",
            country: passport.country,
          }}
        />
      </PassportSection>
      <PassportSection id="occupation" title="Occupation">
        <OccupationForm occupationId={passport.occupationId} occupations={occupations} />
      </PassportSection>
      <PassportSection id="skills" title="Skills">
        <SkillsSection skills={passport.skills} max={limits.skillsMax} />
      </PassportSection>
      <PassportSection id="languages" title="Languages">
        <LanguagesSection languages={passport.languages} options={languages} />
      </PassportSection>
      <PassportSection id="experience" title="Experience and availability">
        <ExperienceForm
          windowMonths={limits.availabilityWindowMonths}
          initial={{
            yearsExperience: passport.yearsExperience === null ? "" : String(passport.yearsExperience),
            availability: passport.availability ?? "",
            availableFrom: passport.availableFrom ?? "",
          }}
        />
      </PassportSection>
      <PassportSection id="preferred-countries" title="Preferred countries">
        <PreferredCountriesSection selected={passport.preferredCountries} countries={countries} />
      </PassportSection>
      <PassportSection
        id="authorizations"
        title="Work authorisation"
        description="The countries where you may work. Add only the country and, if there is one, the date it expires."
      >
        <AuthorizationsSection
          authorizations={passport.authorizations}
          countries={countries}
          expiryYears={limits.authorizationExpiryYears}
        />
      </PassportSection>
    </div>
  );
}
