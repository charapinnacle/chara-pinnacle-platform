import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// The steps that are left once the email is confirmed and the account type is committed: what the person did on an earlier
// page (the account, the account type) is not a step here. An owner must set up two-step verification (FR-A4). Each step
// is a column with its name under the circle, so the six steps of a recruitment or staffing company (FR-J1), Where you
// serve and What you offer each a page of its own, fit the panel as well as three; below 640 px the names give way to a
// "Step 2 of 6: Where you serve" line and stay for screen readers. The steps that staff reopened with a request for
// information (FR-J4) are shown as not done again, and say so to screen readers.
const onboardingJourneys = {
  company: ["Company", "Security", "Ready"],
  partner: ["Company", "Where you serve", "What you offer", "Commitments", "Security", "Ready"],
  worker: ["Your profile", "Ready"],
} as const;

// Classes, not an inline style: the content security policy refuses style attributes in the served page.
const columns: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 6: "grid-cols-6" };

type OnboardingStepsProps = { kind: keyof typeof onboardingJourneys; current: number; reopened?: readonly number[] };

export function OnboardingSteps({ kind, current, reopened = [] }: OnboardingStepsProps) {
  const steps = onboardingJourneys[kind];
  return (
    <div className="grid gap-3">
      <p aria-hidden className="text-small text-muted-foreground tabular-nums sm:hidden">
        {`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
      </p>
      <ol aria-label="Setting up your account" className={cn("grid", columns[steps.length])}>
        {steps.map((label, index) => {
          const state =
            index === current ? "current" : reopened.includes(index) ? "reopened" : index < current ? "done" : "upcoming";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className="relative flex flex-col items-center gap-2 text-center"
            >
              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-3.5 start-[calc(50%+1.25rem)] h-px w-[calc(100%-2.5rem)]",
                    state === "done" ? "bg-brand" : "bg-border",
                  )}
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-caption font-semibold tabular-nums",
                  state === "done" && "border-brand bg-brand text-foreground",
                  state === "current" && "border-primary bg-primary text-primary-foreground",
                  (state === "upcoming" || state === "reopened") && "border-muted-foreground bg-transparent text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
              </span>
              <span
                className={cn(
                  "max-w-full px-1 text-caption leading-snug text-balance max-sm:sr-only",
                  state === "current" ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="sr-only">{`Step ${index + 1} of ${steps.length}: `}</span>
                {label}
                {state === "done" ? <span className="sr-only"> (done)</span> : null}
                {state === "reopened" ? <span className="sr-only"> (more information requested)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
