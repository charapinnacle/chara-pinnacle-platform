import { Card } from "@/components/layout/card";
import { cn } from "@/lib/utils";

type SectionProps = {
  id: string;
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
};

export function Section({ id, title, description, className, children }: SectionProps) {
  return (
    <Card as="section" id={id} padding="lg" elevated className={cn("scroll-mt-6 gap-4 rounded-2xl", className)}>
      <div className="grid gap-1">
        <h2 className="text-h2">{title}</h2>
        {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}
