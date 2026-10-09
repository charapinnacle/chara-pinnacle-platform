import { PortalButton } from "@/components/billing/portal-button";
import { Notice } from "@/components/forms/notice";
import { graceEnd } from "@/lib/dashboard/plan-status";
import { formatShortDate } from "@/lib/i18n/format";

type PastDueAlertProps = { slug: string; pastDueSince: Date; now: Date };

function ShortDate({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{formatShortDate(date.toISOString())}</time>;
}

// The warning for an owner or an admin while a payment has failed (FR-G4): the plan stays until Stripe's retries end on
// the last day of the grace period, and the button opens the portal where the card is changed. A member sees none.
export function PastDueAlert({ slug, pastDueSince, now }: PastDueAlertProps) {
  const end = graceEnd(pastDueSince);
  return (
    <Notice tone="error" role="alert">
      <div className="grid gap-3">
        <p>
          Payment failed on <ShortDate date={pastDueSince} />.{" "}
          {end <= now ? (
            "The grace period has ended. Update your payment method now."
          ) : (
            <>
              Update your payment method before <ShortDate date={end} /> to keep your plan.
            </>
          )}
        </p>
        <PortalButton slug={slug} label="Update payment method" />
      </div>
    </Notice>
  );
}
