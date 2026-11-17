"use client";

import { useEffect, useRef } from "react";
import { TextLink } from "@/components/forms/text-link";
import { recordLimitPrompt } from "@/lib/actions/limits";
import { resetText, usageText, type OrganizationType, type UsagePrompt } from "@/lib/billing/limits";

type UpgradePromptProps = {
  organizationId: string;
  organizationType: OrganizationType;
  prompt: UsagePrompt;
  billingHref: string;
  // Owners and admins can change the plan; a member reads the usage only.
  canUpgrade: boolean;
  // The requirement of a per-requirement limit (the invitations of FR-O1) and the partners the person tried to invite,
  // which the report of the prompt names.
  requirement?: { id: string; attempted: number };
  // Shown after a refused submission: the Upgrade link takes the focus, so the next step is where the person is (FR-R1 AC11).
  focusUpgrade?: boolean;
  // The id of the usage sentence, which a control disabled at the limit names as its description.
  reasonId?: string;
};

// Shown where a plan limit stops a change (FR-R1): the usage and the plan, when a monthly count starts again, and the way
// to a higher plan: how the higher plans of the type compare and the billing page that sells them (V15). Each prompt an
// owner or admin sees is reported once per display for the upgrade KPI.
export function UpgradePrompt({
  organizationId,
  organizationType,
  prompt,
  billingHref,
  canUpgrade,
  requirement,
  focusUpgrade = false,
  reasonId,
}: UpgradePromptProps) {
  const { limitKey, used, limit, resetsAt, planName, comparison } = prompt;
  const upgradeLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (focusUpgrade) upgradeLink.current?.focus();
  }, [focusUpgrade]);

  const requirementId = requirement?.id;
  const attempted = requirement?.attempted;
  useEffect(() => {
    if (!canUpgrade) return;
    void recordLimitPrompt(organizationId, limitKey, requirementId && attempted ? { id: requirementId, attempted } : undefined);
  }, [canUpgrade, organizationId, limitKey, requirementId, attempted]);

  return (
    <div className="grid gap-1 text-small">
      <p id={reasonId} className="font-medium">
        {usageText(limitKey, organizationType, used, limit)} on your {planName ? `${planName} plan` : "plan"}.
      </p>
      {/* A limit of 0 (the free plan after a lapse) does not come back with the month. */}
      {resetsAt && limit > 0 ? <p>{resetText(resetsAt)}</p> : null}
      {canUpgrade ? (
        <>
          {comparison ? <p>{comparison}</p> : null}
          <p>
            <TextLink ref={upgradeLink} href={billingHref}>
              Upgrade your plan
            </TextLink>{" "}
            to add more.
          </p>
        </>
      ) : null}
    </div>
  );
}
