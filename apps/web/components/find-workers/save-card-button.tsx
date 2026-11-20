"use client";

import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { setSavedWorkerCard } from "@/lib/actions/find-workers";

type SaveCardButtonProps = {
  slug: string;
  cardId: string;
  requirementId: string | null;
  saved: boolean;
  // Names the card for assistive technology, which hears many Save buttons on one page.
  cardLabel: string;
};

// Save or Remove of one card, for the requirement the search was opened from or for the organisation (FR-Q2 AC12).
export function SaveCardButton({ slug, cardId, requirementId, saved, cardLabel }: SaveCardButtonProps) {
  const { pending, run } = useActionCall(saved ? "The worker was not removed" : "The worker was not saved");
  const text = saved ? "Remove from saved" : requirementId ? "Save for this requirement" : "Save";
  return (
    <FormButton
      type="button"
      variant="secondary"
      className="w-auto"
      aria-busy={pending || undefined}
      aria-label={`${text}: ${cardLabel}`}
      onClick={() => {
        if (!pending) run(() => setSavedWorkerCard({ slug, cardId, requirementId, saved: !saved }), saved ? "Worker removed from saved" : "Worker saved");
      }}
    >
      {text}
    </FormButton>
  );
}
