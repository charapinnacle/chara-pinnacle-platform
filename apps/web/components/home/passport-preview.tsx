// A fictional person: an illustration of the CHARA Passport (FR-B1), never data of the platform.
const rows = [
  { label: "Skills", chips: ["MIG/MAG welding", "TIG welding", "Blueprint reading"] },
  { label: "Languages", chips: ["Polish · native", "English · B2", "German · A2"] },
  { label: "Preferred countries", chips: ["Germany", "Netherlands"] },
] as const;

// Decoration, hidden from assistive technology. The ring shows the profile completeness as the passport page does (FR-B4).
export function PassportPreview() {
  return (
    <div aria-hidden className="light w-full max-w-md justify-self-center overflow-hidden rounded-2xl border bg-card text-foreground shadow-[0_40px_80px_-32px_rgb(0_0_0/0.45)]">
      <div className="dark flex items-center justify-between gap-4 bg-background px-6 py-5 text-foreground">
        <div className="grid gap-1">
          <p className="text-eyebrow text-brand uppercase">CHARA Passport</p>
          <p className="text-h2">Jana Novak</p>
          <p className="text-small text-muted-foreground">TIG welder · ISCO 7212 · Gdańsk, Poland</p>
        </div>
        <span className="relative flex size-16 shrink-0 items-center justify-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" className="stroke-border" />
            <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset="15" className="stroke-brand" />
          </svg>
          <span className="text-small font-semibold tabular-nums">85%</span>
        </span>
      </div>
      <div className="grid gap-5 p-6">
        <div className="grid gap-1 border-b pb-5">
          <p className="text-caption text-muted-foreground">Experience</p>
          <p className="text-small font-semibold">TIG welder, shipyard · 8 years</p>
        </div>
        {rows.map(({ label, chips }) => (
          <div key={label} className="grid gap-2">
            <p className="text-caption text-muted-foreground">{label}</p>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span key={chip} className="rounded-full border bg-background px-3 py-1 text-caption font-medium">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 rounded-lg bg-success-background px-4 py-3">
          <p className="text-small font-medium text-success-foreground">Available from 1 November</p>
          <span className="size-2 rounded-full bg-success-foreground" />
        </div>
      </div>
      <p className="border-t px-6 py-2.5 text-caption text-muted-foreground">Illustration with fictional data</p>
    </div>
  );
}
