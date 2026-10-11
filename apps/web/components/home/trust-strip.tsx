import { Globe, Lock, ShieldCheck, Wallet } from "lucide-react";

// Each statement is checked against the product: workers pay nothing (Pricing, the workers_never_pay rules), documents are
// private until a worker shares them (Trust & Safety), the database and the documents are in Frankfurt (OPEN_QUESTIONS.md O1;
// the web host is not decided, so it does not say "hosted"), and owners and administrators must enrol two-step verification
// before they open applicants, billing or the team (FR-A4).
const statements = [
  { text: "Workers never pay", icon: Wallet },
  { text: "Documents private by default", icon: Lock },
  { text: "Data stored in the EU", icon: Globe },
  { text: "Two-step verification for employer admins", icon: ShieldCheck },
] as const;

export function TrustStrip() {
  return (
    <section aria-label="What you can rely on" className="bg-background">
      <ul
        data-reveal
        className="mx-auto grid w-full max-w-6xl px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 [&>li]:border-t [&>li:first-child]:border-t-0 sm:[&>li:nth-child(2)]:border-t-0 lg:[&>li]:border-t-0 lg:[&>li]:border-s lg:[&>li:first-child]:border-s-0 sm:max-lg:[&>li:nth-child(even)]:border-s"
      >
        {statements.map(({ text, icon: Icon }) => (
          <li key={text} className="flex items-center gap-4 py-5 sm:px-6 sm:max-lg:odd:ps-0 lg:py-8 lg:first:ps-0">
            <Icon aria-hidden className="size-6 shrink-0 text-brand-ink" strokeWidth={1.5} />
            <span className="text-body text-pretty">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
