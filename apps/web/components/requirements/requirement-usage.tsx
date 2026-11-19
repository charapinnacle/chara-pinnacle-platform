import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { Notice } from "@/components/forms/notice";
import { usageText, type UsagePrompt } from "@/lib/billing/limits";

type RequirementUsageProps = {
  organizationId: string;
  // Null while the limit does not apply (not enforced, or a plan without one): nothing is shown then.
  prompt: UsagePrompt | null;
  billingHref: string;
  // Owners and admins get the way to a higher plan; a member reads the usage only.
  canUpgrade: boolean;
};

// "2 of 3 open workforce requirements on your Basic plan" (FR-M4). At the limit the upgrade prompt of the plan limits
// (V13) takes its place, with the hint that pausing or closing a requirement makes room.
export function RequirementUsage({ organizationId, prompt, billingHref, canUpgrade }: RequirementUsageProps) {
  if (!prompt) return null;
  if (prompt.used < prompt.limit) {
    return (
      <p className="text-small text-muted-foreground">
        {usageText(prompt.limitKey, "employer", prompt.used, prompt.limit)} on your{" "}
        {prompt.planName ? `${prompt.planName} plan` : "plan"}.
      </p>
    );
  }
  return (
    <Notice tone="warning" role="status">
      <UpgradePrompt organizationId={organizationId} organizationType="employer" prompt={prompt} billingHref={billingHref} canUpgrade={canUpgrade} />
      {canUpgrade && prompt.limit > 0 ? <p className="mt-1">Pause or close an open requirement to make room.</p> : null}
    </Notice>
  );
}
