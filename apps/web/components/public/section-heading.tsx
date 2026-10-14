type SectionHeadingProps = {
  id: string;
  eyebrow: string;
  title: string;
};

export function SectionHeading({ id, eyebrow, title }: SectionHeadingProps) {
  return (
    <div className="grid content-start gap-4">
      <p className="text-eyebrow text-brand-ink uppercase">{eyebrow}</p>
      <h2 id={id} className="max-w-[18ch] text-section text-balance">
        {title}
      </h2>
    </div>
  );
}
