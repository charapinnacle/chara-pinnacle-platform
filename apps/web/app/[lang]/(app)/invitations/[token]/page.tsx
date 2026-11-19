import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { AcceptInvitationButton } from "@/components/team/accept-invitation-button";
import { getCurrentUser, requireUser } from "@/lib/dal/session";
import { getInvitationPreview } from "@/lib/dal/team";
import { formatDate } from "@/lib/i18n/format";
import { homePath } from "@/lib/routes";
import {
  COMPANY_TYPE_CANNOT_JOIN,
  invitationAccounts,
  invitationTokenSchema,
  roleLabels,
  workerCannotJoin,
} from "@/lib/validation/team";

export const metadata: Metadata = {
  title: "Team invitation",
  robots: { index: false },
  referrer: "no-referrer",
};

export default async function InvitationPage({ params }: PageProps<"/[lang]/invitations/[token]">) {
  const { lang, token } = await params;
  const parsed = invitationTokenSchema.safeParse(token);
  const preview = parsed.success ? await getInvitationPreview(parsed.data) : null;
  const signedIn = (await getCurrentUser()) !== null;
  const user = signedIn ? await requireUser(lang) : null;
  // An account joins only an organisation of the type it registered as (FR-J1): an employer account an employer, a
  // recruitment or staffing company account a company of its own type.
  const wrongType =
    user?.accountKind === "company" && preview !== null && (user.intendedOrganizationType ?? "employer") !== preview.organizationType;

  if (user && (user.accountKind === "worker" || wrongType)) {
    return (
      <AuthCard icon={MailCheck} title="Team invitation">
        <Notice tone="error" role="alert">
          {user.accountKind === "worker" ? workerCannotJoin(preview?.organizationType ?? "employer") : COMPANY_TYPE_CANNOT_JOIN}
        </Notice>
        <TextLink standalone="center" href={homePath(lang, user.accountKind)}>
          Back to your dashboard
        </TextLink>
      </AuthCard>
    );
  }
  if (user && user.accountKind === null) redirect(homePath(lang, null));

  if (!parsed.success || !preview) {
    return (
      <AuthCard icon={MailCheck} title="Team invitation">
        <Notice tone="error" role="alert">
          This invitation is no longer valid. Ask the person who invited you for a new link.
        </Notice>
        {user ? (
          <TextLink standalone="center" href={homePath(lang, user.accountKind)}>
            Back to your dashboard
          </TextLink>
        ) : null}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={MailCheck}
      title={`Join ${preview.organizationName}`}
      description={`You are invited as ${roleLabels[preview.role].toLowerCase()}. The invitation was sent to ${preview.email} and is valid until ${formatDate(preview.expiresAt)}.`}
    >
      {user ? (
        <AcceptInvitationButton token={parsed.data} />
      ) : (
        <div className="grid gap-2">
          <TextLink standalone href={`/${lang}/signup?invitation=${parsed.data}`}>
            Create {invitationAccounts[preview.organizationType].label}
          </TextLink>
          <TextLink
            standalone
            href={`/${lang}/login?next=${encodeURIComponent(`/${lang}/invitations/${parsed.data}`)}`}
          >
            I already have an account
          </TextLink>
        </div>
      )}
      {user ? (
        <p className="text-small text-muted-foreground">
          Not the right account? Log out and log in again with {preview.email}.
        </p>
      ) : null}
    </AuthCard>
  );
}
