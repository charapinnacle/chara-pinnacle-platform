import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";

export function ShortlistingUpgrade({ billingHref }: { billingHref: string }) {
  return (
    <Notice tone="info" role="status">
      Your plan does not include shortlisting, so applicants cannot be moved to Shortlisted.{" "}
      <TextLink href={billingHref}>Upgrade your plan</TextLink>
    </Notice>
  );
}
