import { cn } from "@/lib/utils";

type PassportSectionProps = {
  id: string;
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
};

export function PassportSection({ id, title, description, className, children }: PassportSectionProps) {
  return (
    <section id={id} className={cn("grid scroll-mt-6 gap-4 rounded-2xl border bg-card p-5 shadow-card sm:p-6", className)}>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
