import { Band } from "@/components/home/band";
import { LinkButton } from "@/components/layout/link-button";
import { signUpPath } from "@/lib/routes";

// The sections of the passport page (FR-B1, FR-B2) and the two rules that keep its documents private (FR-B3, FR-B5).
const contents = [
  "Occupation and experience",
  "Skills and languages",
  "Availability",
  "Preferred countries",
  "Work authorisation",
  "CV and certificates",
] as const;

const privacy = [
  "Your documents are private. You choose which ones an employer sees, application by application.",
  "When an organisation opens one of your documents, your access log shows who opened it and when.",
] as const;

export function PassportSection({ lang }: { lang: string }) {
  return (
    <Band aria-labelledby="home-passport-heading" className="grid gap-12 lg:grid-cols-12 lg:gap-8">
      <div className="grid content-start justify-items-start gap-6 lg:col-span-5">
        <p className="text-eyebrow text-brand-ink uppercase">CHARA Passport</p>
        <h2 id="home-passport-heading" className="text-section text-balance">
          One professional profile. Multiple opportunities.
        </h2>
        <p className="text-lead text-pretty text-muted-foreground">Create it once and apply with it to any vacancy.</p>
        <LinkButton href={signUpPath(lang, "worker")} prefetch={false} className="mt-2">
          Create your CHARA Passport
        </LinkButton>
      </div>
      <div className="grid content-start gap-10 lg:col-span-6 lg:col-start-7">
        <ul aria-label="What your CHARA Passport holds" className="grid sm:grid-cols-2 sm:gap-x-8">
          {contents.map((item) => (
            <li key={item} className="border-t py-4 text-body font-medium">
              {item}
            </li>
          ))}
        </ul>
        <ul className="grid gap-4 border-t pt-6">
          {privacy.map((rule) => (
            <li key={rule} className="text-body text-pretty text-muted-foreground">
              {rule}
            </li>
          ))}
        </ul>
      </div>
    </Band>
  );
}
