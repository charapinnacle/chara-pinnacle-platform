import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  id: string;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  tone?: "default" | "inverse";
};

export function SectionHeading({ id, eyebrow, title, description, tone = "default" }: SectionHeadingProps) {
  const inverse = tone === "inverse";
  return (
    <div className="grid max-w-2xl gap-3">
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
