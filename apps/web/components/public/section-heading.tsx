import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  id: string;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  tone?: "default" | "inverse";
  className?: string;
};

// The heading of a section of a marketing page: a small upper-case label, the h2 (its id names the section) and a quiet
// line under it.
export function SectionHeading({ id, eyebrow, title, description, tone = "default", className }: SectionHeadingProps) {
  const inverse = tone === "inverse";
  return (
    <div className={cn("grid max-w-2xl gap-3", className)}>
      {eyebrow ? (
        <p className={cn("text-eyebrow uppercase", inverse ? "text-brand" : "text-brand-ink")}>{eyebrow}</p>
      ) : null}
      <h2 id={id} className={cn("text-h1 text-balance", inverse && "text-inverse-foreground")}>
        {title}
      </h2>
      {description ? (
        <p className={cn("text-lead text-pretty", inverse ? "text-inverse-muted" : "text-muted-foreground")}>{description}</p>
      ) : null}
    </div>
  );
}
