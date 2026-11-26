import { cn } from "@/lib/utils";

// Whether a section of the workforce profile is complete, still needs something, or may stay empty.
export type SectionStatus = "done" | "todo" | "optional";

export type ProfileSectionLink = { headingId: string; title: string; status: SectionStatus };

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
