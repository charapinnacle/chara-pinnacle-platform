import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/layout/card";
import type { FirstSteps } from "@/lib/dal/dashboard";
import { billingPath, jobsPath, membersPath, mfaPath } from "@/lib/routes";

type GuidedStepsProps = { lang: string; organizationSlug: string; twoStepDone: boolean; steps: FirstSteps };

// The first steps of an organisation, each ticked from what the database holds (UX-04): an open step is the link that
// does it, a done one is plain text. The trial is offered on the billing page, not here, because whether a new
// organisation may have one is decided at checkout (FR-E5, open point C14).
export function GuidedSteps({ lang, organizationSlug, twoStepDone, steps }: GuidedStepsProps) {
  // An organisation exists by the time this list shows, so its first step is always done and needs no link.
  const list: { label: string; done: boolean; href?: string }[] = [
    { label: "Create your organisation", done: true },
    { label: "Set up two-step verification", done: twoStepDone, href: mfaPath(lang) },
    { label: "Publish your first vacancy", done: steps.vacancyPublished, href: `${jobsPath(lang, organizationSlug)}/new` },
    { label: "Invite a team member", done: steps.teamInvited, href: membersPath(lang, organizationSlug) },
    { label: "Choose a plan", done: steps.planChosen, href: billingPath(lang, organizationSlug) },
  ];
  const done = list.filter((step) => step.done).length;

  return (
    <Card as="section" aria-labelledby="first-steps-heading" padding="lg" elevated className="content-start gap-4">
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="first-steps-heading" className="text-h2">
            Get set up
          </h2>
          <p className="text-small text-muted-foreground tabular-nums">
            {done} of {list.length} done
          </p>
        </div>
        <progress
          aria-label="First steps done"
          value={done}
          max={list.length}
          className="h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand"
        />
      </div>
      <ol className="grid gap-1 text-body">
        {list.map((step) => (
          <li key={step.label}>
            {step.done || !step.href ? (
              <span className="flex min-h-11 items-center gap-3 px-2 text-muted-foreground">
                <CircleCheck aria-hidden className="size-5 shrink-0 text-brand-ink" strokeWidth={1.75} />
                <span>
                  {step.label}
                  <span className="sr-only"> (done)</span>
                </span>
              </span>
            ) : (
              <Link
                href={step.href}
                className="group flex min-h-11 items-center gap-3 rounded-lg px-2 font-medium transition-colors duration-150 hover:bg-secondary"
              >
                <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="flex-1">{step.label}</span>
                <ArrowRight aria-hidden className="size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
