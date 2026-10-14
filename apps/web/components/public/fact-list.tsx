export type Fact = { title: string; text: string };

// Statements the product enforces, each a short title and one line between hairlines.
export function FactList({ label, facts }: { label: string; facts: readonly Fact[] }) {
  return (
    <ul aria-label={label} className="border-b">
      {facts.map(({ title, text }) => (
        <li key={title} className="grid gap-1 border-t py-6">
          <p className="text-h2">{title}</p>
          <p className="text-body text-pretty text-muted-foreground">{text}</p>
        </li>
      ))}
    </ul>
  );
}
