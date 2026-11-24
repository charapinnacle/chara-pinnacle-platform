import { ArrowLeft } from "lucide-react";
import { LinkButton } from "@/components/layout/link-button";

// The foot of a partner onboarding step (FR-J1): Back to the step before, and the step's own submit button.
export function StepActions({ backHref, children }: { backHref?: string; children: React.ReactNode }) {
  if (!backHref) return children;
  return (
    <div className="step-actions flex items-center justify-between gap-3">
      <LinkButton href={backHref} variant="secondary" className="min-h-12">
        <ArrowLeft aria-hidden className="size-4" />
        Back
      </LinkButton>
      {children}
    </div>
  );
}
