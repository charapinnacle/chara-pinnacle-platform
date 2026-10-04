import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChooseKindForm } from "@/components/consent/choose-kind-form";
import { CommitKind } from "@/components/consent/commit-kind";
import { ConsentForm } from "@/components/consent/consent-form";
import { AuthCard } from "@/components/layout/auth-card";
import { OrganizationForm } from "@/components/organization/organization-form";
import { commitAccountKind } from "@/lib/actions/consents";
import { getOnboardingDocuments, getSignUpForm } from "@/lib/dal/legal";
import { getMyOrganization } from "@/lib/dal/organizations";
import { getInvitationPreview } from "@/lib/dal/team";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { requireUser } from "@/lib/dal/session";
import { pendingInvitationToken } from "@/lib/invitation-cookie";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Welcome — CHARA" };

const kindLabel = { worker: "Worker", company: "Employer" } as const;

export default async function OnboardingPage({
  params,
}: PageProps<"/[lang]/onboarding">) {
  const { lang } = await params;
  const user = await requireUser(lang);

  if (user.accountKind === "company") {
    const [organization, countries, industries] = await Promise.all([
      getMyOrganization(user.id),
      getCountries(),
      getIndustries(),
    ]);
    if (organization) redirect(homePath(lang, "company"));
    const invitation = await pendingInvitationToken();
    if (invitation && (await getInvitationPreview(invitation))) redirect(`/${lang}/invitations/${invitation}`);
    return (
      <AuthCard
        title="Your account type is Employer"
        description="This cannot be changed later. Tell us about your company to finish setting up."
      >
        <OrganizationForm lang={lang} countries={countries} industries={industries} />
      </AuthCard>
    );
  }

  if (user.accountKind) {
    return (
      <AuthCard
        title={`Your account type is ${kindLabel[user.accountKind]}`}
        description="This cannot be changed later."
      />
    );
  }

  if (!user.intendedAccountKind) {
    const form = await getSignUpForm();
    return (
      <AuthCard
        title="Choose your account type"
        description="Tell us how you will use CHARA and accept the documents for it to finish creating your account."
      >
        <ChooseKindForm documents={form.documents} attestationWording={form.attestationWording} />
      </AuthCard>
    );
  }

  const { documents, attestationWording } = await getOnboardingDocuments(
    user.intendedAccountKind,
  );
  const kind = kindLabel[user.intendedAccountKind];
  return (
    <AuthCard
      title={`Set up your ${kind} account`}
      description={
        documents.length === 0
          ? undefined
          : `A document you accepted at sign-up has changed, or was not recorded. Accept the current version to continue. Your account type is ${kind} and cannot be changed later.`
      }
    >
      {documents.length === 0 ? (
        <CommitKind />
      ) : (
        <ConsentForm
          documents={documents}
          attestationWording={attestationWording}
          submitLabel="Accept and continue"
          onAccept={commitAccountKind}
        />
      )}
    </AuthCard>
  );
}
