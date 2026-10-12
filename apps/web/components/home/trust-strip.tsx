import { Flag, Globe, Lock, ShieldCheck, Wallet } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";

// Each statement is checked against the product: workers pay nothing (Pricing, the workers_never_pay rules), documents are
// private until a worker shares them (Trust & Safety), the database and the documents are in Frankfurt (OPEN_QUESTIONS.md O1;
// the web host is not decided, so it does not say "hosted"), owners and administrators must enrol two-step verification
// before they open applicants, billing or the team (FR-A4), and a vacancy that breaks the rules can be hidden (FR-C7).
const statements = [
  { text: "Workers never pay", icon: Wallet },
  { text: "Documents private by default", icon: Lock },
  { text: "Data stored in the EU", icon: Globe },
  { text: "Two-step verification for employer admins", icon: ShieldCheck },
  { text: "Vacancies are moderated", icon: Flag },
] as const;

export function TrustStrip({ lang }: { lang: string }) {
  return (
    <section aria-label="What you can rely on" className="border-b bg-background">
      <div data-reveal className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10">
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          {statements.map(({ text, icon: Icon }) => (
            <li key={text} className="flex items-center gap-3">
              <Icon aria-hidden className="size-5 shrink-0 text-brand-ink" strokeWidth={1.75} />
              <span className="text-small font-medium text-pretty">{text}</span>
            </li>
          ))}
        </ul>
        <TextLink standalone href={`/${lang}/trust-safety`} prefetch={false}>
          Trust &amp; Safety
        </TextLink>
      </div>
    </section>
  );
}
