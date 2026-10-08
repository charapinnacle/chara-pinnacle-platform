import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import type { MemberRole } from "@/lib/validation/team";

const UPGRADE = "Upgrade to shortlist applicants";

export function ShortlistingUpgrade({ role, billingHref }: { role: MemberRole; billingHref: string }) {
  return (
    <Notice tone="info" role="status">
      {role === "member" ? (
        <>
          {UPGRADE}. Your plan does not include shortlisting, so applicants cannot be moved to Shortlisted. Contact an owner
          or admin of your organization to upgrade the plan.
        </>
      ) : (
        <>
          <TextLink href={billingHref}>{UPGRADE}</TextLink>. Your plan does not include shortlisting, so applicants cannot be
          moved to Shortlisted.
        </>
      )}
    </Notice>
  );
}
