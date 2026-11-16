import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { reportPath } from "@/lib/routes";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";

// FR-O4 step Protect (AC11): the candidate's pages say that workers never pay and lead to the report form with the fee
// demand category and the partner as the subject.
export function WorkersNeverPay({ lang, partnerName, partnerSlug }: { lang: string; partnerName: string; partnerSlug: string | null }) {
  return (
    <Notice tone="info" className="grid gap-1">
      <p>{WORKERS_NEVER_PAY}.</p>
      {partnerSlug ? (
        <p>
          <TextLink href={reportPath(lang, "partner_profile", partnerSlug, "fee_demanded_from_worker")}>
            Report a fee demand by {partnerName}
          </TextLink>
        </p>
      ) : null}
    </Notice>
  );
}
