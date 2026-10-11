import type { Step } from "@/lib/public/steps";

type StepListProps = { steps: readonly Step[]; titleAs?: "h3" | "h4"; compact?: boolean };

// compact keeps the numbered titles and leaves out the sentence under each (the home page; How CHARA Works has them in full).
export function StepList({ steps, titleAs: Title = "h3", compact = false }: StepListProps) {
  if (compact) {
    return (
      <ol className="grid gap-3">
        {steps.map(({ title }, index) => (
          <li key={title} className="flex items-baseline gap-4">
            <span aria-hidden className="w-4 text-small font-semibold text-brand-ink tabular-nums">
              {index + 1}
            </span>
            <span className="text-body">{title}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="grid animate-stagger gap-6">
      {steps.map(({ title, text }, index) => (
        <li key={title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4">
          <span
            aria-hidden
            className="row-span-2 flex size-9 items-center justify-center rounded-lg bg-brand-gradient text-small font-semibold text-inverse tabular-nums"
          >
            {index + 1}
          </span>
          <Title className="pt-1.5 text-h3">{title}</Title>
          <p className="text-body leading-6 text-muted-foreground">{text}</p>
        </li>
      ))}
    </ol>
  );
}
