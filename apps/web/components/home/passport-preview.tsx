import { UserRound } from "lucide-react";

const fields = ["Occupation", "Skills", "Languages", "Availability"] as const;

// A placeholder of the CHARA Passport: the fields it holds with empty bars where the values go, and a ring that fills once.
// Nothing here is a person or a number; it is decoration, hidden from assistive technology.
export function PassportPreview() {
  return (
    <div aria-hidden className="light w-full max-w-md justify-self-center rounded-3xl border bg-card p-8 text-foreground shadow-[0_32px_64px_-32px_rgb(0_0_0/0.7)] lg:justify-self-end">
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-eyebrow text-brand-ink uppercase">CHARA Passport</p>
          <p className="font-serif text-section">Your profile</p>
        </div>
        <span className="relative flex size-16 shrink-0 items-center justify-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2" className="stroke-border" />
            <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2" strokeLinecap="round" pathLength="100" strokeDashoffset="28" className="passport-ring stroke-brand-ink" />
          </svg>
          <UserRound className="size-6 text-muted-foreground" strokeWidth={1.5} />
        </span>
      </div>
      <div className="mt-8 grid gap-5">
        {fields.map((field) => (
          <div key={field} className="grid gap-2 border-t pt-4">
            <p className="text-caption text-muted-foreground">{field}</p>
            <div className="flex gap-2">
              <span className="h-3 w-2/5 rounded-full bg-muted" />
              {field === "Skills" || field === "Languages" ? <span className="h-3 w-1/5 rounded-full bg-muted" /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
