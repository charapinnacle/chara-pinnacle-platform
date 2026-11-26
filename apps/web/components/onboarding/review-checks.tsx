import { Check } from "lucide-react";
import { REVIEW_CHECKS } from "@/lib/validation/partner-review";

// What staff check in the review of a partner (FR-J1 AC11), on the Ready step and, compact, on the pending dashboard.
export function ReviewChecks({ id, compact }: { id: string; compact?: boolean }) {
  if (compact) {
    return (
      <section aria-labelledby={id} className="grid gap-2">
        <h3 id={id} className="text-small font-medium text-muted-foreground">
          What our team checks
        </h3>
        <ul className="flex flex-wrap gap-2">
          {REVIEW_CHECKS.map((check) => (
            <li key={check} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-small">
              <Check aria-hidden className="size-3.5 text-brand-ink" />
              {check}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h2 id={id} className="text-h3">
        What our team checks
      </h2>
      <ul className="grid list-disc gap-1 ps-5 text-body">
        {REVIEW_CHECKS.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
    </section>
  );
}
