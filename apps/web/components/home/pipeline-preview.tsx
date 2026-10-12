import { applicationStatusLabels } from "@/lib/applications/presentation";
import { cn } from "@/lib/utils";

// Fictional people and dates: an illustration of the applicant board of a vacancy, never data of the platform.
const columns = [
  {
    stage: "applied",
    cards: [
      { name: "Lukas Brandt", detail: "Welder · 6 years", date: "8 Oct" },
      { name: "Priya Nair", detail: "Welder · 3 years", date: "7 Oct" },
      { name: "Mateo Rossi", detail: "Metal fabricator · 9 years", date: "6 Oct" },
    ],
  },
  {
    stage: "shortlisted",
    cards: [
      { name: "Amara Okafor", detail: "Welder · 11 years", date: "5 Oct" },
      { name: "Tomás Ruiz", detail: "Pipe welder · 7 years", date: "4 Oct" },
    ],
  },
  { stage: "interview", cards: [{ name: "Jana Novak", detail: "TIG welder · 8 years", date: "2 Oct" }] },
] as const;

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("");

// Decoration, hidden from assistive technology: the real board is the applicants page of a vacancy (FR-E1). It draws the
// same stages and the same card facts with the light token set, so it reads as a screen of the product on any band.
export function PipelinePreview() {
  return (
    <div aria-hidden className="light w-full overflow-hidden rounded-2xl border bg-background text-foreground shadow-[0_40px_80px_-32px_rgb(0_0_0/0.65)]">
      <div className="flex items-center justify-between gap-4 border-b bg-card px-5 py-4">
        <div className="grid gap-0.5">
          <p className="text-caption text-muted-foreground">Applicants</p>
          <p className="text-small font-semibold">Welder (MIG/MAG) · Hamburg</p>
        </div>
        <span className="rounded-full bg-success-background px-3 py-1 text-caption font-medium text-success-foreground">Open</span>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
        {columns.map(({ stage, cards }, index) => (
          <div key={stage} className={cn("grid content-start gap-2", index === 2 && "max-sm:hidden")}>
            <p className="flex items-center justify-between px-1 text-caption font-semibold">
              {applicationStatusLabels[stage]}
              <span className="text-muted-foreground tabular-nums">{cards.length}</span>
            </p>
            {cards.map(({ name, detail, date }) => (
              <div key={name} className="grid gap-2 rounded-lg border bg-card p-3 shadow-card">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-accent-foreground">
                    {initials(name)}
                  </span>
                  <span className="truncate text-caption font-semibold">{name}</span>
                </div>
                <p className="truncate text-caption text-muted-foreground">{detail}</p>
                <p className="text-caption text-muted-foreground">Applied {date}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="border-t bg-card px-5 py-2.5 text-caption text-muted-foreground">Illustration with fictional data</p>
    </div>
  );
}
