import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { reportPath } from "@/lib/routes";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";

// FR-O4 step Protect (AC11), FR-J3 AC8: the candidate's pages say that workers never pay and lead to the report form
// with the fee demand category and the submission as the subject (V57), so a fee demand is reported whether or not the
// partner's profile is public.
export function WorkersNeverPay({ lang, partnerName, submissionId }: { lang: string; partnerName: string; submissionId: string }) {
  return (
    <Notice tone="info" className="grid gap-1">
      <p>{WORKERS_NEVER_PAY}.</p>
      <p>
        <TextLink href={reportPath(lang, "candidate_submission", submissionId, "fee_demanded_from_worker")}>
          Report a fee demand by {partnerName}
        </TextLink>
      </p>
    </Notice>
  );
}
