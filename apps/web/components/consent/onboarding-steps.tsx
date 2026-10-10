import { cn } from "@/lib/utils";

type OnboardingStepsProps = { current: 1 | 2; kind: "worker" | "company" | null };

const finalStep = { worker: "Passport", company: "Organisation" } as const;

// The three steps of setting up an account: the account itself (done once the email is confirmed), the account type
// with its documents, then the passport or the organisation.
export function OnboardingSteps({ current, kind }: OnboardingStepsProps) {
  const steps = ["Account", "Account type", kind ? finalStep[kind] : "Profile"];
  return (
    <ol aria-label="Setting up your account" className="grid grid-cols-3 gap-2">
      {steps.map((label, index) => (
        <li key={label} aria-current={index === current ? "step" : undefined} className="grid gap-2">
          <span
            aria-hidden
            className={cn(
              "h-1 rounded-full",
              index <= current ? "bg-brand" : "bg-border",
              index === current && "animate-in duration-500 ease-brand fade-in slide-in-from-start-2",
            )}
          />
          <span className={cn("text-caption", index === current ? "font-semibold text-foreground" : "text-muted-foreground")}>
            <span className="sr-only">{`Step ${index + 1} of ${steps.length}: `}</span>
            {label}
            {index < current ? <span className="sr-only"> (done)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
