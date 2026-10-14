import { Band } from "@/components/home/band";
import { FactList } from "@/components/public/fact-list";
import { SectionHeading } from "@/components/public/section-heading";

// Only what the code enforces: one profile (FR-B1), documents private and shared per application (FR-B3, FR-D1), the access
// log (FR-B5; repeated openings within seconds share one entry, so it does not say "every"), and that workers never pay (FR-G6).
const facts = [
  { title: "One profile for every application", text: "Describe your work once, then apply to any open vacancy without retyping it." },
  {
    title: "You decide who sees your documents",
    text: "Documents are private by default and shared only with the employer of an application you send.",
  },
  { title: "You see who opened them", text: "Your access log shows which organisation opened which document, and when." },
  { title: "Workers never pay", text: "Creating a profile, searching and applying are free." },
] as const;

export function PassportSection() {
  return (
    <Band aria-labelledby="home-passport-heading" className="grid gap-12 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-5">
        <SectionHeading id="home-passport-heading" eyebrow="CHARA Passport" title="One professional profile. Multiple opportunities." />
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <FactList label="What your CHARA Passport gives you" facts={facts} />
      </div>
    </Band>
  );
}
