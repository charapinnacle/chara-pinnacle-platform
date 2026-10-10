import { TextLink } from "@/components/forms/text-link";
import { classifyUsage, type UsageState } from "@/lib/billing/usage";
import type { Usage } from "@/lib/dal/billing";
import { cn } from "@/lib/utils";

const USAGE_NAMES = { active_jobs: "Open vacancies", members: "Team members" } as const satisfies Record<Usage["key"], string>;

const OVER_LIMIT_TEXT = {
  active_jobs: "Existing vacancies stay open. No more can be opened until usage is below the limit.",
  members: "Existing members stay. No more can be invited until usage is below the limit.",
} as const satisfies Record<Usage["key"], string>;

const STATE_TEXT: Record<UsageState, string | null> = {
  ok: null,
  unlimited: null,
  at_limit: "Limit reached",
  over_limit: "Over the limit",
};

type UsageSectionProps = { usage: Usage[]; upgradeHref: string | null };

// Usage against the limits of the plan. The state is said in words next to the bar, so that colour is not the only cue.
export function UsageSection({ usage, upgradeHref }: UsageSectionProps) {
  return (
    <section aria-labelledby="usage-heading" className="grid gap-4 rounded-xl border bg-card p-4">
      <h2 id="usage-heading" className="text-h2">
        Usage
      </h2>
      <ul className="grid gap-5">
        {usage.map(({ key, used, limit }) => {
          const level = classifyUsage(used, limit);
          const stateText = STATE_TEXT[level.state];
          return (
            <li key={key} className="grid gap-2">
              <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-medium">{USAGE_NAMES[key]}</span>
                <span>{level.label}</span>
              </p>
              {limit !== null && level.percent !== null ? (
                <div
                  role="progressbar"
                  aria-label={USAGE_NAMES[key]}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={Math.min(used, limit)}
                  aria-valuetext={level.label}
                  className="h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={cn("h-full rounded-full", level.state === "ok" ? "bg-primary" : "bg-destructive")}
                    style={{ width: `${level.percent}%` }}
                  />
                </div>
              ) : null}
              {stateText ? (
                <p className="text-small font-medium">
                  {stateText}
                  {upgradeHref ? (
                    <>
                      {". "}
                      <TextLink href={upgradeHref} aria-label={`Upgrade (${USAGE_NAMES[key]})`}>
                        Upgrade
                      </TextLink>
                    </>
                  ) : null}
                </p>
              ) : null}
              {level.state === "over_limit" ? <p className="text-small text-muted-foreground">{OVER_LIMIT_TEXT[key]}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
