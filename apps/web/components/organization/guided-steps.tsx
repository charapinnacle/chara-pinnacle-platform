import { Circle, CircleCheck } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { defaultLocale } from "@/lib/i18n/locale";
import { mfaPath } from "@/lib/routes";

type GuidedStepsProps = { twoStepDone: boolean };

const upcoming = ["Start the free trial", "Post the first vacancy", "Invite a team member"];

export function GuidedSteps({ twoStepDone }: GuidedStepsProps) {
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
          <TextLink href={mfaPath(defaultLocale)}>Set up two-step verification</TextLink>
        )}
      </li>
      {upcoming.map((step) => (
        <li key={step} className="flex items-center gap-3 text-muted-foreground">
          <Circle aria-hidden className="size-5 shrink-0" />
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}
