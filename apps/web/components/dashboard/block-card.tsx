import { Card } from "@/components/layout/card";

// A figure of a partner dashboard block: its label is the term, so each count is read with its name.
export function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="text-body font-medium">{children}</dd>
    </div>
  );
}

export function BlockCard({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card as="section" padding="lg" aria-labelledby={id} className="content-start gap-3">
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {children}
    </Card>
  );
}
