import { Circle, CircleCheck, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

// Whether a section of the workforce profile is complete, still needs something, or may stay empty.
export type SectionStatus = "done" | "todo" | "optional";

export type ProfileSectionLink = { headingId: string; title: string; status: SectionStatus };

const statusText: Record<SectionStatus, string> = { done: "done", todo: "needs your attention", optional: "optional" };

function StatusIcon({ status }: { status: SectionStatus }) {
  if (status === "done") return <CircleCheck aria-hidden className="size-4 shrink-0 text-success-foreground" />;
  if (status === "todo") return <CircleDot aria-hidden className="size-4 shrink-0 text-brand-ink" />;
  return <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

// The sections of the page with their state: a row that scrolls sideways on a phone, a list that stays in view beside
// the sections from lg up.
export function SectionNav({ sections }: { sections: readonly ProfileSectionLink[] }) {
  return (
    <nav aria-label="Sections of the workforce profile" className="lg:sticky lg:top-8 lg:self-start">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 [contain:inline-size] lg:mx-0 lg:grid lg:gap-1 lg:overflow-visible lg:px-0 lg:[contain:none]">
        {sections.map((section) => (
          <li key={section.headingId}>
            <a
              href={`#${section.headingId}`}
              className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-small font-medium whitespace-nowrap transition-colors outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 lg:border-transparent lg:bg-transparent"
            >
              <StatusIcon status={section.status} />
              {section.title}
              <span className="sr-only">, {statusText[section.status]}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// One section of the workforce profile as a white card: its title, one line on what it is for, then its form or, for a
// member, what was given.
export function ProfileSection({
  headingId,
  title,
  description,
  optional,
  className,
  children,
}: {
  headingId: string;
  title: string;
  description?: React.ReactNode;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={headingId} className={cn("grid min-w-0 gap-5 rounded-2xl border bg-card p-5 sm:p-7", className)}>
      <header className="grid gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id={headingId} className="scroll-mt-8 text-h2">
            {title}
          </h2>
          {optional ? <span className="text-small text-muted-foreground">Optional</span> : null}
        </div>
        {description ? <p className="max-w-prose text-body text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
