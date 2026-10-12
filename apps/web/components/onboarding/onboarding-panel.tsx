type OnboardingPanelProps = {
  steps?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
};

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
