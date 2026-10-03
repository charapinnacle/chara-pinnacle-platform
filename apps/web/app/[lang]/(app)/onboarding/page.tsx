import type { Metadata } from "next";
import { CommitKind } from "@/components/consent/commit-kind";
import { ConsentForm } from "@/components/consent/consent-form";
import { commitAccountKind } from "@/lib/actions/consents";
import { getOnboardingDocuments } from "@/lib/dal/legal";
import { requireUser } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Welcome — CHARA" };

const kindLabel = { worker: "Worker", company: "Employer" } as const;

export default async function OnboardingPage({
  params,
}: PageProps<"/[lang]/onboarding">) {
  const { lang } = await params;
  const user = await requireUser(lang);

  if (user.accountKind) {
    return (
      <div className="grid max-w-xl gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your account type is {kindLabel[user.accountKind]}
        </h1>
        <p>This cannot be changed later.</p>
      </div>
    );
  }

  const { documents, attestationWording } = await getOnboardingDocuments(
    user.intendedAccountKind,
  );
  return (
    <div className="grid max-w-xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Set up your {kindLabel[user.intendedAccountKind]} account
      </h1>
      {documents.length === 0 ? (
        <CommitKind />
      ) : (
        <>
          <p>
            A document you accepted at sign-up has changed, or was not recorded.
            Accept the current version to continue. Your account type is{" "}
            {kindLabel[user.intendedAccountKind]} and cannot be changed later.
          </p>
          <ConsentForm
            documents={documents}
            attestationWording={attestationWording}
            submitLabel="Accept and continue"
            onAccept={commitAccountKind}
          />
        </>
      )}
    </div>
  );
}
