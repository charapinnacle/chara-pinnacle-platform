import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import { Notice } from "@/components/forms/notice";
import { LinkButton } from "@/components/layout/link-button";
import { showsNudge, type Completeness } from "@/lib/passport/completeness";

type CompletenessCardProps = { lang: string; completeness: Completeness };

// The meter, the next item as the one primary action, the nine items in two columns and how the score is made. The meter
// is a progress element (role progressbar) and the percentage is also written out, so colour carries no meaning.
export function CompletenessCard({ lang, completeness }: CompletenessCardProps) {
  const { percent, items, next } = completeness;
  return (
    <div className="@container grid gap-5">
      <div className="grid gap-3">
        <p className="flex items-baseline gap-2 font-medium">
          <span className="text-figure tabular-nums">{percent}%</span> <span className="text-muted-foreground">complete</span>
        </p>
        <progress
          aria-label="Passport completeness"
          value={percent}
          max={100}
          className="h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-500"
        />
      </div>
      {next ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-muted-foreground">
          Next:
          <LinkButton href={`/${lang}/passport#${next.section}`} size="default" className="gap-2">
            {next.label}
            <ArrowRight aria-hidden className="size-4" />
          </LinkButton>
        </p>
      ) : (
        <p className="text-body font-medium">Profile complete</p>
      )}
      {next && showsNudge(percent) ? (
        <Notice role="note" aria-label="Complete your passport">
          A complete passport gives employers more to act on.
        </Notice>
      ) : null}
      <ol className="grid gap-x-6 gap-y-2 text-body @md:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3">
            {item.done ? (
              <CircleCheck aria-hidden className="size-5 shrink-0 text-brand-ink" strokeWidth={1.75} />
            ) : (
              <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            )}
            <span className={item.done ? undefined : "text-muted-foreground"}>
              {item.label}
              <span className="sr-only"> ({item.done ? "done" : "not done"})</span>
            </span>
          </li>
        ))}
      </ol>
      <details className="group text-body">
        <summary className="min-h-11 w-fit cursor-pointer rounded-sm py-2.5 font-medium underline decoration-brand decoration-[1.5px] underline-offset-4">
          How is this calculated?
        </summary>
        <div className="grid gap-2 pt-2">
          <p className="text-muted-foreground">
            The score is the sum of the points of the items you have completed, out of 100. Nothing else counts.
          </p>
          <ul className="grid gap-1">
            {items.map((item) => (
              <li key={item.key}>
                <span className="font-medium">
                  {item.label}: {item.weight} points
                </span>
                <span className="text-muted-foreground">. {item.rule}.</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
