import { Circle, CircleCheck } from "lucide-react";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { showsNudge, type Completeness } from "@/lib/passport/completeness";

type CompletenessCardProps = { lang: string; completeness: Completeness };

export function CompletenessCard({ lang, completeness }: CompletenessCardProps) {
  const { percent, items, next } = completeness;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="font-medium">{percent}% complete</p>
        <progress
          aria-label="Passport completeness"
          value={percent}
          max={100}
          className="h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
        />
      </div>
      <p className="text-body">
        {next ? (
          <>
            Next: <TextLink href={`/${lang}/passport#${next.section}`}>{next.label}</TextLink>
          </>
        ) : (
          "Profile complete"
        )}
      </p>
      {next && showsNudge(percent) ? (
        <Notice role="note" aria-label="Complete your passport">
          A complete passport gives employers more to act on.
        </Notice>
      ) : null}
      <ol className="grid gap-1 text-body">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3">
            {item.done ? (
              <CircleCheck aria-hidden className="size-5 shrink-0 text-primary" />
            ) : (
              <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            )}
            <span className={item.done ? undefined : "text-muted-foreground"}>
              {item.label}
              <span className="sr-only"> ({item.done ? "done" : "not done"})</span>
            </span>
          </li>
        ))}
      </ol>
      <details className="text-body">
        <summary className="min-h-11 w-fit cursor-pointer rounded-sm py-2.5 font-medium text-primary underline underline-offset-4">
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
