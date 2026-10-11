import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const stages = [
  { label: "Applied", state: "done" },
  { label: "Viewed", state: "done" },
  { label: "Shortlisted", state: "current" },
  { label: "Interview", state: "next" },
] as const;

// Decoration, hidden from assistive technology: the real tracker is on the application page. Generic on purpose, no employer,
// no number, no date. The delays of its drawing follow the position of each stage (home.css).
export function JourneyPreview() {
  return (
    <div aria-hidden className="w-full max-w-sm justify-self-center lg:justify-self-end">
      <div className="rounded-2xl border bg-card/70 p-6 shadow-card backdrop-blur sm:p-8">
        <p className="text-eyebrow text-brand uppercase">Your application</p>
        <p className="mt-2 text-h2">Your vacancy</p>
        <ol className="mt-8 grid">
          {stages.map(({ label, state }, index) => (
            <li key={label} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-4 pb-8 last:pb-0">
              {state === "done" ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-brand text-inverse">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              ) : state === "current" ? (
                <span className="journey-current flex size-6 items-center justify-center rounded-full border-2 border-brand bg-card ring-4 ring-brand/20">
                  <span className="size-2 rounded-full bg-brand" />
                </span>
              ) : (
                <span className="size-6 rounded-full border border-input" />
              )}
              <span className="grid">
                <span className={cn("text-body", state === "next" ? "text-muted-foreground" : "font-medium")}>{label}</span>
                {state === "current" ? <span className="text-caption text-brand">Current stage</span> : null}
              </span>
              {index < stages.length - 1 ? (
                <span className="absolute start-[calc(0.75rem-0.5px)] top-7 bottom-1 w-px bg-border">
                  {stages[index + 1].state !== "next" ? <span className="journey-line absolute inset-0 bg-brand" /> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
