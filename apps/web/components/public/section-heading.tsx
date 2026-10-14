type SectionHeadingProps = {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
};

// The head of a section of the home and For employers pages: the eyebrow, then the h2 whose id names the section, and at
// most one line under it.
export function SectionHeading({ id, eyebrow, title, description }: SectionHeadingProps) {
  return (
    <div className="grid content-start gap-4">
      <p className="text-eyebrow text-brand-ink uppercase">{eyebrow}</p>
      <h2 id={id} className="max-w-[18ch] text-section text-balance">
        {title}
      </h2>
      {description ? <p className="max-w-[52ch] text-lead text-pretty text-muted-foreground">{description}</p> : null}
    </div>
  );
}
