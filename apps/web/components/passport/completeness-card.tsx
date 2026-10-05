import { Circle, CircleCheck } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import type { Completeness } from "@/lib/passport/completeness";

type CompletenessCardProps = { lang: string; completeness: Completeness };

export function CompletenessCard({ lang, completeness }: CompletenessCardProps) {
  const { percent, items, next } = completeness;
  const passportPath = `/${lang}/passport`;
  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">Your passport</h2>
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
            Next: <TextLink href={`${passportPath}#${next.section}`}>{next.label}</TextLink>
          </>
        ) : (
          "You have added everything we ask for so far."
        )}
      </p>
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
      <TextLink standalone href={passportPath}>
        Open your passport
      </TextLink>
    </section>
  );
}
