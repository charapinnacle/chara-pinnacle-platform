import { PartnerSteps } from "@/components/onboarding/onboarding-steps";
import { StepHeading } from "@/components/onboarding/step-heading";

type OnboardingPanelProps = {
  steps?: React.ReactNode;
  // A step of the partner journey (FR-J1): the wide layout with the steps beside the form instead of above it.
  partnerStep?: { current: number; reopened?: readonly number[] };
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export function OnboardingPanel({ steps, partnerStep, title, description, children }: OnboardingPanelProps) {
  const heading = (
    <div className="grid gap-2">
      <StepHeading title={title} />
      {description ? <p className="text-body leading-relaxed text-pretty text-muted-foreground">{description}</p> : null}
    </div>
  );
  if (partnerStep) {
    return (
      <div className="partner-step grid animate-rise gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <aside className="grid gap-4 lg:sticky lg:top-8">
          <PartnerSteps current={partnerStep.current} reopened={partnerStep.reopened} />
          <p className="text-caption leading-relaxed text-muted-foreground max-lg:hidden">
            Each step is saved when you continue. Our team reviews your company before it is listed.
          </p>
        </aside>
        <div className="grid min-w-0 gap-6">
          {heading}
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto grid w-full max-w-[35rem] animate-rise gap-8 sm:rounded-card sm:border sm:bg-card sm:p-card-3xl sm:shadow-card">
      {steps}
      {heading}
      {children}
    </div>
  );
}
