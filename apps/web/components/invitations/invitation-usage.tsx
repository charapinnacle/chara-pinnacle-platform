import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { Notice } from "@/components/forms/notice";
import type { UsagePrompt } from "@/lib/billing/limits";
import { atInvitationLimit, invitationUsageText, type InvitationUsage as Usage } from "@/lib/invitations/presentation";
import { INVITATION_LIMIT_KEY } from "@/lib/invitations/refusal";

type InvitationUsageProps = {
  organizationId: string;
  requirementId: string;
  usage: Usage;
  billingHref: string;
  // Owners and admins get the way to a higher plan; a member reads the usage only.
  canUpgrade: boolean;
};

function usagePrompt(usage: Usage): UsagePrompt | null {
  if (!atInvitationLimit(usage) || usage.limit === null) return null;
  return { limitKey: INVITATION_LIMIT_KEY, used: usage.used, limit: usage.limit, resetsAt: null, planName: usage.planName, comparison: null };
}

// "5 of 10 invitations used on your Professional plan" (FR-O1 AC9; withdrawn invitations do not count). At the limit the
// upgrade prompt of the plan limits (V13) takes its place, with the hint that withdrawing an invitation makes room.
export function InvitationUsage({ organizationId, requirementId, usage, billingHref, canUpgrade }: InvitationUsageProps) {
  const prompt = usagePrompt(usage);
  if (!prompt) {
    return (
      <p className="text-small text-muted-foreground">
        {invitationUsageText(usage)}
        {usage.applies && usage.limit !== null ? ` on your ${usage.planName ? `${usage.planName} plan` : "plan"}` : null}.
      </p>
    );
  }
  return (
    <Notice tone="warning" role="status">
      <UpgradePrompt
        organizationId={organizationId}
        organizationType="employer"
        prompt={prompt}
        billingHref={billingHref}
        canUpgrade={canUpgrade}
        requirement={{ id: requirementId, attempted: 1 }}
      />
      {canUpgrade && prompt.limit > 0 ? <p className="mt-1">Withdrawing an invitation before a response makes room.</p> : null}
    </Notice>
  );
}
