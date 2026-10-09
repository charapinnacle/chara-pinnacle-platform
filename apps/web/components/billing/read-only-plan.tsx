import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";

// The controls that a plan does not allow point here (aria-describedby), so the reason is read with them.
export const READ_ONLY_REASON_ID = "read-only-reason";

type ReadOnlyPlanNoticeProps = { ended: boolean; billingHref: string | null; otherwise?: string };

// Said above the applicants and the vacancies of an organisation whose subscription has ended (FR-G4): the past applicants
// stay readable and every change needs an active plan. Only an owner or an admin gets the link. An organisation that
// never subscribed gets the page's own text, when it has one.
export function ReadOnlyPlanNotice({ ended, billingHref, otherwise }: ReadOnlyPlanNoticeProps) {
  if (!ended && !otherwise) return null;
  return (
    <Notice id={READ_ONLY_REASON_ID} tone="info" role="status" className="grid gap-1">
      <p>
        {ended
          ? "Your subscription has ended. Your past applicants stay readable, and changes to them need an active plan."
          : otherwise}
      </p>
      {ended && billingHref ? (
        <TextLink href={billingHref} className="justify-self-start">
          Choose a plan
        </TextLink>
      ) : null}
    </Notice>
  );
}
