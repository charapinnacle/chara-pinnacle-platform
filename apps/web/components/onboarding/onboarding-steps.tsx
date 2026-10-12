import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// The steps that are left once the email is confirmed and the account type is committed: what the person did on an earlier
// page (the account, the account type) is not a step here. An owner must set up two-step verification (FR-A4). Below
// 640 px only the current step is named beside the circles, under "Step 2 of 3"; the other names stay for screen readers.
const onboardingJourneys = {
  company: ["Company", "Security", "Ready"],
  worker: ["Your profile", "Ready"],
} as const;

type OnboardingStepsProps = { kind: keyof typeof onboardingJourneys; current: number };

export function OnboardingSteps({ kind, current }: OnboardingStepsProps) {
  const steps = onboardingJourneys[kind];
  return (
    <div className="grid gap-3">
      <p aria-hidden className="text-small text-muted-foreground tabular-nums sm:hidden">
        {`Step ${current + 1} of ${steps.length}`}
      </p>
      <ol aria-label="Setting up your account" className="flex items-center gap-2 sm:gap-3">
        {steps.map((label, index) => {
          const state = index < current ? "done" : index === current ? "current" : "upcoming";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 last:flex-none sm:gap-3"
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-caption font-semibold tabular-nums",
                  state === "done" && "border-brand bg-brand text-foreground",
                  state === "current" && "border-primary bg-primary text-primary-foreground",
                  state === "upcoming" && "border-muted-foreground/60 bg-transparent text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-small whitespace-nowrap",
                  state === "current" ? "font-semibold text-foreground" : "text-muted-foreground max-sm:sr-only",
                )}
              >
                <span className="sr-only">{`Step ${index + 1} of ${steps.length}: `}</span>
                {label}
                {state === "done" ? <span className="sr-only"> (done)</span> : null}
              </span>
              {index < steps.length - 1 ? (
                <span aria-hidden className={cn("h-px min-w-4 flex-1", state === "done" ? "bg-brand" : "bg-border")} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
