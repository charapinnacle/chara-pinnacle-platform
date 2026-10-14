import { Band } from "@/components/public/band";
import { LinkButton } from "@/components/layout/link-button";
import { NumberedSteps } from "@/components/public/numbered-steps";
import { SectionHeading } from "@/components/public/section-heading";
import { signUpPath } from "@/lib/routes";

// What a candidate does, in the words of the product: the passport (FR-B1), the documents chosen per application (FR-D1)
// and the journey tracker (FR-D3).
const steps = [
  {
    title: "Create your CHARA Passport",
    text: "Add your occupation, skills, languages, experience and the countries where you may work.",
  },
  {
    title: "Apply with the documents you choose",
    text: "Pick which of your documents each employer may see. The others stay private.",
  },
  {
    title: "Follow every stage of your application",
    text: "See when it is viewed, shortlisted, invited to interview and decided.",
  },
] as const;

export function HowItWorks({ lang }: { lang: string }) {
  return (
    <Band aria-labelledby="home-how-heading" className="grid gap-12 sm:gap-16 lg:gap-20">
      <SectionHeading id="home-how-heading" eyebrow="How it works" title="From profile to offer, in three steps." />
      <NumberedSteps steps={steps} />
      <div>
        <LinkButton href={signUpPath(lang, "worker")} prefetch={false} className="min-h-12 px-6">
          Create your CHARA Passport
        </LinkButton>
      </div>
    </Band>
  );
}
