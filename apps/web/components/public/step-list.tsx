import type { Step } from "@/lib/public/steps";

export function StepList({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="grid">
      {steps.map(({ title, text }, index) => (
        <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] border-t py-4">
          <span aria-hidden className="text-small leading-6 font-semibold text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <div className="grid gap-1">
            <h3 className="text-h3">{title}</h3>
            <p className="text-small text-muted-foreground">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
