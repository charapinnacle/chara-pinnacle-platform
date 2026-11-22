import { Card } from "@/components/layout/card";
import { cn } from "@/lib/utils";

type StepCardProps = {
  title: string;
  hint?: React.ReactNode;
  // Short fields side by side from 640 px; a field that needs the full width takes sm:col-span-2.
  columns?: boolean;
  children: React.ReactNode;
};

// One group of questions of a partner onboarding step (FR-J1), as a titled card, so a step reads as a few short blocks
// instead of one long column of fields.
export function StepCard({ title, hint, columns = false, children }: StepCardProps) {
  return (
    <Card padding="lg" elevated>
      <fieldset className={cn("grid min-w-0 gap-5", columns && "sm:grid-cols-2 sm:items-start")}>
        <legend className="mb-4 text-h3">{title}</legend>
        {hint ? <p className="-mt-3 text-small leading-relaxed text-muted-foreground sm:col-span-2">{hint}</p> : null}
        {children}
      </fieldset>
    </Card>
  );
}
