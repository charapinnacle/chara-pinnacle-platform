import type { Metadata } from "next";
import { Users } from "lucide-react";
import { z } from "zod";
import { SuspendedOrganization } from "@/components/applicants/suspended-organization";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { InviteDialog } from "@/components/team/invite-dialog";
import { MemberActions } from "@/components/team/member-actions";
import { ResendInvitation } from "@/components/team/resend-invitation";
import { TransferOwnership, TransferResponse } from "@/components/team/ownership-transfer";
import { getAllowance, getInvitations, getMembers, getPendingTransfer, type TeamMember } from "@/lib/dal/team";
import { requireOrgRole, roleRank } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { billingPath } from "@/lib/routes";
import { roleLabels } from "@/lib/validation/team";

export const metadata: Metadata = { title: "Team — CHARA", robots: { index: false } };

function displayName(member: TeamMember): string {
  return member.name ?? member.email ?? "Team member";
}

function mfaStatus(member: TeamMember): string {
  if (member.role === "member") return "Not required";
  return member.mfaEnrolled ? "Enrolled" : "Not enrolled";
}

export default async function MembersPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/members">) {
  const [{ lang, slug }, { after }] = await Promise.all([params, searchParams]);
  const { user, organization } = await requireOrgRole(lang, slug, "member");
  if (organization.suspended) return <SuspendedOrganization title="Team" subject="team members" />;
  const manager = organization.role !== "member";
  const cursor = z.uuid().safeParse(after);

  const [page, invitations, allowance, transfer] = await Promise.all([
    getMembers(organization.id, cursor.success ? cursor.data : null),
    manager ? getInvitations(organization.id) : [],
    manager ? getAllowance(organization.id) : null,
    getPendingTransfer(organization.id),
  ]);
  const members = page.members.toSorted((a, b) => roleRank[b.role] - roleRank[a.role]);
  const nameOf = (userId: string) => {
    const member = page.members.find((entry) => entry.userId === userId);
    return member ? displayName(member) : "a team member";
  };
  const onlyOwner = members.length === 1 && !cursor.success && invitations.length === 0;
  const candidates = members
    .filter((member) => member.role !== "owner")
    .map((member) => ({ value: member.userId, label: displayName(member) }));
  const invite = allowance ? (
    <InviteDialog slug={slug} billingHref={billingPath(lang, slug)} allowance={allowance} />
  ) : null;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Team</h1>
          <p className="text-body text-muted-foreground">{organization.displayName}</p>
        </div>
        {!onlyOwner ? invite : null}
      </header>

      {transfer?.toUserId === user.id ? (
        <Notice tone="info" role="status" className="grid gap-3">
          <p>
            {nameOf(transfer.fromUserId)} asked you to become the owner of {organization.displayName}. If you confirm,
            you become the owner and they become an administrator. This request expires on{" "}
            {formatDate(transfer.expiresAt)}.
          </p>
          <TransferResponse slug={slug} mode="accept" />
        </Notice>
      ) : null}
      {transfer && organization.role === "owner" ? (
        <Notice tone="info" role="status" className="grid gap-3">
          <p>
            Waiting for {nameOf(transfer.toUserId)} to confirm becoming the owner. This request expires on{" "}
            {formatDate(transfer.expiresAt)}.
          </p>
          <TransferResponse slug={slug} mode="cancel" />
        </Notice>
      ) : null}

      {onlyOwner ? (
        <EmptyState icon={Users} title="You are the only member" description="Invite colleagues to work on vacancies and applicants with you.">
          {invite}
        </EmptyState>
      ) : null}

      <section aria-labelledby="members-heading" className="grid gap-3">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members
        </h2>
        <ul className="grid gap-3">
          {members.map((member) => (
            <li key={member.userId} className="grid gap-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="font-medium break-words">{displayName(member)}</p>
                  {member.name && member.email ? (
                    <p className="text-sm break-all text-muted-foreground">{member.email}</p>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{roleLabels[member.role]}</span>
                  {manager ? <> · Two-step verification: {mfaStatus(member)}</> : null}
                </p>
              </div>
              {manager && member.role !== "owner" && member.userId !== user.id ? (
                <MemberActions slug={slug} userId={member.userId} name={displayName(member)} role={member.role} />
              ) : null}
            </li>
          ))}
        </ul>
        {page.nextCursor ? (
          <TextLink standalone href={`/${lang}/org/${slug}/members?after=${page.nextCursor}`}>
            Show more members
          </TextLink>
        ) : null}
        {cursor.success ? (
          <TextLink standalone href={`/${lang}/org/${slug}/members`}>
            Back to the first members
          </TextLink>
        ) : null}
      </section>

      {manager && invitations.length > 0 ? (
        <section aria-labelledby="invitations-heading" className="grid gap-3">
          <h2 id="invitations-heading" className="text-lg font-semibold">
            Invitations
          </h2>
          <ul className="grid gap-3">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                <div className="min-w-0">
                  <p className="font-medium break-all">{invitation.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {roleLabels[invitation.role]} ·{" "}
                    {invitation.expired
                      ? "Expired"
                      : invitation.open
                        ? `Pending, expires on ${formatDate(invitation.expiresAt)}`
                        : "No longer valid, the person who sent it left or changed role"}
                  </p>
                </div>
                {!invitation.open ? (
                  <ResendInvitation slug={slug} email={invitation.email} role={invitation.role} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {organization.role === "owner" && candidates.length > 0 && !transfer ? (
        <section aria-labelledby="ownership-heading" className="grid gap-3">
          <h2 id="ownership-heading" className="text-lg font-semibold">
            Ownership
          </h2>
          <p className="text-body text-muted-foreground">
            There is always exactly one owner. To hand the role over, choose a member who then has to confirm.
          </p>
          <div>
            <TransferOwnership slug={slug} candidates={candidates} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
