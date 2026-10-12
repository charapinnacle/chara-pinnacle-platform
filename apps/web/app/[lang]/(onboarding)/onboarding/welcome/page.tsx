import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import { OnboardingSteps } from "@/components/onboarding/onboarding-steps";
import { WelcomeTiles } from "@/components/onboarding/welcome-tiles";
import { getMyOrganization } from "@/lib/dal/organizations";
import { getPassport } from "@/lib/dal/passport";
import { requireUser } from "@/lib/dal/session";
import { billingPath, homePath, jobsPath, membersPath, onboardingPath } from "@/lib/routes";
import { welcomeIsDue } from "@/lib/welcome-cookie";

export const metadata: Metadata = { title: "Welcome — CHARA", robots: { index: false } };

// Shown once, right after the last step (welcome-cookie.ts); any later visit goes to the dashboard, whose empty states
// guide from then on.
export default async function WelcomePage({ params }: PageProps<"/[lang]/onboarding/welcome">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (!(await welcomeIsDue(user.id))) redirect(homePath(lang, user.accountKind));

  if (user.accountKind === "company") {
    const organization = await getMyOrganization(user.id);
    if (!organization) redirect(onboardingPath(lang));
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="company" current={2} />}
        title={`Welcome to CHARA Pinnacle, ${organization.displayName}`}
        description="Your company is set up and your account is protected. Choose where to start."
      >
        <WelcomeTiles
          tiles={[
            { href: `${jobsPath(lang, organization.slug)}/new`, title: "Post your first job", text: "Describe the role and publish it." },
            { href: membersPath(lang, organization.slug), title: "Invite your team", text: "Hire together with your colleagues." },
            { href: billingPath(lang, organization.slug), title: "Review your plan", text: "Compare the plans and choose yours." },
          ]}
        />
      </OnboardingPanel>
    );
  }

  const passport = await getPassport(user.id);
  if (!passport) redirect(onboardingPath(lang));
  return (
    <OnboardingPanel
      steps={<OnboardingSteps kind="worker" current={1} />}
      title={`Welcome to CHARA Pinnacle, ${passport.firstName}`}
      description="Your passport is ready. Choose where to start."
    >
      <WelcomeTiles
        tiles={[
          { href: `/${lang}/jobs`, title: "Search jobs", text: "Find vacancies that match your skills." },
          { href: `/${lang}/passport`, title: "Complete your passport", text: "Add your occupation, skills and languages." },
          { href: `/${lang}/passport#experience`, title: "Set availability", text: "Tell employers when you can start." },
        ]}
      />
    </OnboardingPanel>
  );
}
