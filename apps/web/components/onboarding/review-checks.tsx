import { REVIEW_CHECKS } from "@/lib/validation/partner-review";

// What staff check in the review of a partner (FR-J1 AC11), on the Ready step and the pending dashboard.
export function ReviewChecks({ id }: { id: string }) {
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
