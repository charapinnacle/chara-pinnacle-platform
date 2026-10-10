import type { Step } from "@/lib/public/steps";

export function StepList({ steps, titleAs: Title = "h3" }: { steps: readonly Step[]; titleAs?: "h3" | "h4" }) {
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
