import type { Step } from "@/lib/public/steps";

type StepListProps = { steps: readonly Step[]; titleAs?: "h3" | "h4" };

export function StepList({ steps, titleAs: Title = "h3" }: StepListProps) {
  return (
    <ol className="grid">
      {steps.map(({ title, text }, index) => (
        <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] border-t py-4">
          <span aria-hidden className="text-small leading-6 font-semibold text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <div className="grid gap-1">
            <Title className="text-h3">{title}</Title>
            <p className="text-small text-muted-foreground">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
