import { Band } from "@/components/home/band";
import { LinkButton } from "@/components/layout/link-button";
import { signUpPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Only what exists today: the later phases of the client's structure (recruitment and staffing accounts, workforce
// requirements, matching) are not offered here (D81).
const audiences = [
  {
    id: "home-worker",
    heading: "Worker",
    bullets: [
      "Create your CHARA Passport",
      "Search jobs",
      "Apply",
      "Store skills and certificates",
      "Manage availability",
      "Track applications",
    ],
    kind: "worker",
    button: "I'm a worker",
    tone: "light",
  },
  {
    id: "home-employer",
    heading: "Employer",
    bullets: ["Post jobs", "Manage applicants", "Invite your team"],
    kind: "company",
    button: "I'm an employer",
    tone: "dark",
  },
] as const;

export function WhoAreYou({ lang }: { lang: string }) {
  return (
    <Band tone="tint" aria-labelledby="home-who-heading" className="grid gap-12">
      <h2 id="home-who-heading" className="font-serif text-section text-balance">
        Who are you?
      </h2>
      <div className="grid gap-6 md:grid-cols-2">
        {audiences.map(({ id, heading, bullets, kind, button, tone }) => (
          <section
            key={id}
            aria-labelledby={id}
            className={cn(
              "lift grid content-between gap-10 rounded-3xl border p-8 sm:p-12",
              tone === "dark" ? "dark border-transparent bg-background text-foreground" : "bg-card",
            )}
          >
            <div className="grid content-start gap-6">
              <h3 id={id} className="font-serif text-section">
                {heading}
              </h3>
              <ul className="grid list-disc gap-2 ps-5 text-body marker:text-brand">
                {bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>
            <LinkButton href={signUpPath(lang, kind)} className="lift justify-self-start">
              {button}
            </LinkButton>
          </section>
        ))}
      </div>
      <p className="text-small text-muted-foreground">Recruitment and staffing companies join in a later phase.</p>
    </Band>
  );
}
