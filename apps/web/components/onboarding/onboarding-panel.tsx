type OnboardingPanelProps = {
  steps?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
};

// One step of onboarding: where the person is, what the step asks in one heading and one calm line, then its form. On a
// phone the step lies on the page itself; from 640 px it is one white card in the centred column of the layout.
export function OnboardingPanel({ steps, title, description, children }: OnboardingPanelProps) {
  return (
    <div className="grid animate-rise gap-8 sm:rounded-card sm:border sm:bg-card sm:p-card-3xl sm:shadow-card">
      {steps}
      <div className="grid gap-2">
        <h1 className="text-h1 text-balance">{title}</h1>
        {description ? <p className="text-body leading-relaxed text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
