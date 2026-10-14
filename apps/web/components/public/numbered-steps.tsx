import type { Step } from "@/lib/public/steps";

// The list is ordered, so the number is hidden from assistive technology.
export function NumberedSteps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="grid gap-10 md:grid-cols-3 md:gap-8 lg:gap-14">
      {steps.map(({ title, text }, index) => (
        <li key={title} className="grid content-start gap-2.5 border-t border-foreground pt-5">
          <span aria-hidden className="mb-5 text-small font-semibold text-brand-ink tabular-nums">
            {index + 1}
          </span>
          <h3 className="text-title text-balance">{title}</h3>
          <p className="max-w-[34ch] text-body text-pretty text-muted-foreground">{text}</p>
        </li>
      ))}
    </ol>
  );
}
