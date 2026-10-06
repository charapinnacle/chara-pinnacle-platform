import { Circle, CircleCheck } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { jobsPath, mfaPath } from "@/lib/routes";

type GuidedStepsProps = { lang: string; organizationSlug: string; twoStepDone: boolean };

export function GuidedSteps({ lang, organizationSlug, twoStepDone }: GuidedStepsProps) {
  return (
    <ol className="grid gap-3 text-start text-body">
      <li className="flex items-center gap-3">
        {twoStepDone ? (
          <CircleCheck aria-hidden className="size-5 shrink-0 text-primary" />
        ) : (
          <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        )}
        {twoStepDone ? (
          <span>
            Set up two-step verification<span className="sr-only"> (done)</span>
          </span>
        ) : (
          <TextLink href={mfaPath(lang)}>Set up two-step verification</TextLink>
        )}
      </li>
      <li className="flex items-center gap-3 text-muted-foreground">
        <Circle aria-hidden className="size-5 shrink-0" />
        <span>Start the free trial</span>
      </li>
      <li className="flex items-center gap-3">
        <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <TextLink href={jobsPath(lang, organizationSlug)}>Post the first vacancy</TextLink>
      </li>
      <li className="flex items-center gap-3">
        <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <TextLink href={`/${lang}/org/${organizationSlug}/members`}>Invite a team member</TextLink>
      </li>
    </ol>
  );
}
