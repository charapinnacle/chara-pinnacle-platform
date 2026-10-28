import { LinkButton } from "@/components/layout/link-button";
import { invitationUsageText, type InvitationUsage } from "@/lib/invitations/presentation";
import { requirementInvitationsPath } from "@/lib/routes";

type RequirementInvitationsProps = { lang: string; slug: string; requirementId: string; usage: InvitationUsage | null };

// The way from a published requirement to the partners invited to it (FR-O1 step Track; FR-M1 step Next steps), with
// the allowance used ("1 of 3 invitations used"); a failed read of the allowance leaves the count out, not the link.
export function RequirementInvitations({ lang, slug, requirementId, usage }: RequirementInvitationsProps) {
  return (
    <section aria-labelledby="requirement-invitations-heading" className="grid gap-3">
      <h2 id="requirement-invitations-heading" className="text-h2">
        Invitations
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        Follow each partner you invited: whether they saw, accepted or declined the invitation.
        {usage ? ` ${invitationUsageText(usage)}.` : null}
      </p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={requirementInvitationsPath(lang, slug, requirementId)} variant="secondary" size="default">
          See invitations
        </LinkButton>
      </div>
    </section>
  );
}
