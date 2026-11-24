import { Check } from "lucide-react";
import Link from "next/link";
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

const partnerHints = [
  "Name, country and registration",
  "The countries you work with",
  "Occupations and how you recruit",
  "The employer-pays commitment",
  "Two-step verification",
  "Submit for review",
] as const;

// Classes, not an inline style (see columns above): the progress bar of the partner journey at each of its six steps.
const progressWidths = ["w-1/6", "w-2/6", "w-3/6", "w-4/6", "w-5/6", "w-full"] as const;

export type PartnerStepNavigation = {
  // The furthest step the partner may open: every step before it is done.
  reach?: number;
  // The address of each step the owner or an admin may go back to; null for one without a page (Security).
  links?: readonly (string | null)[];
};

// The partner journey (FR-J1) beside the form from 1024 px: each step with what it asks for, and each step already reached
// a link back to it. Below that a slim progress bar with "Step 3 of 6: What you offer" takes its place, and the list stays
// for screen readers.
export function PartnerSteps({
  current,
  reopened = [],
  reach = current,
  links = [],
}: { current: number; reopened?: readonly number[] } & PartnerStepNavigation) {
  const steps = onboardingJourneys.partner;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 lg:hidden">
        <p aria-hidden className="text-small font-medium tabular-nums">
          {`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
        </p>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className={cn("h-full rounded-full bg-brand", progressWidths[current])} />
        </div>
      </div>
      <ol aria-label="Setting up your account" className="grid gap-1 max-lg:sr-only">
        {steps.map((label, index) => {
          const state =
            index === current ? "current" : reopened.includes(index) ? "reopened" : index < reach ? "done" : "upcoming";
          const href = index !== current && index <= reach ? links[index] : null;
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 rounded-lg px-3 py-2.5",
                state === "current" && "bg-card shadow-card",
                href && "transition-colors hover:bg-card/70 has-focus-visible:ring-2 has-focus-visible:ring-ring",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "row-span-2 grid size-7 place-items-center rounded-full border text-caption font-semibold tabular-nums",
                  state === "done" && "border-brand bg-brand text-foreground",
                  state === "current" && "border-primary bg-primary text-primary-foreground",
                  (state === "upcoming" || state === "reopened") && "border-muted-foreground text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
              </span>
              <span className={cn("text-small leading-snug", state === "current" ? "font-semibold" : "font-medium")}>
                <span className="sr-only">{`Step ${index + 1} of ${steps.length}: `}</span>
                {href ? (
                  <Link href={href} className="outline-none after:absolute after:inset-0 after:rounded-lg">
                    {label}
                  </Link>
                ) : (
                  label
                )}
                {state === "done" ? <span className="sr-only"> (done)</span> : null}
                {state === "reopened" ? <span className="sr-only"> (more information requested)</span> : null}
              </span>
              {state === "reopened" ? (
                <span aria-hidden className="text-caption leading-snug font-medium text-warning-foreground">
                  More information requested
                </span>
              ) : (
                <span className="text-caption leading-snug text-muted-foreground">{partnerHints[index]}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
