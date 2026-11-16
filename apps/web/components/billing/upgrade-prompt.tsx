"use client";

import { useEffect } from "react";
import { TextLink } from "@/components/forms/text-link";
import { recordLimitPrompt } from "@/lib/actions/limits";
import { resetText, usageText, type OrganizationType, type UsagePrompt } from "@/lib/billing/limits";

type UpgradePromptProps = {
  organizationId: string;
  organizationType: OrganizationType;
  prompt: UsagePrompt;
  // Null until the billing page sells the organisation's plans: the higher plans are compared instead.
  billingHref: string | null;
  // Owners and admins can change the plan; a member reads the usage only.
  canUpgrade: boolean;
};

// Shown where a plan limit stops a change (FR-R1): the usage and the plan, when a monthly count starts again, and the way
// to a higher plan. Each prompt an owner or admin sees is reported once per display for the upgrade KPI.
export function UpgradePrompt({ organizationId, organizationType, prompt, billingHref, canUpgrade }: UpgradePromptProps) {
  const { limitKey, used, limit, resetsAt, planName, comparison } = prompt;

  useEffect(() => {
    if (canUpgrade) void recordLimitPrompt(organizationId, limitKey);
  }, [canUpgrade, organizationId, limitKey]);

  return (
    <div className="grid gap-1 text-small">
      <p className="font-medium">
        {usageText(limitKey, organizationType, used, limit)} on your {planName ? `${planName} plan` : "plan"}.
      </p>
      {resetsAt ? <p>{resetText(resetsAt)}</p> : null}
      {canUpgrade ? (
        billingHref ? (
          <p>
            <TextLink href={billingHref}>Upgrade your plan</TextLink> to add more.
          </p>
        ) : comparison ? (
          <p>{comparison}</p>
        ) : null
      ) : null}
    </div>
  );
}
