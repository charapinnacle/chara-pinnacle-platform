import { Band } from "@/components/home/band";
import { TextLink } from "@/components/forms/text-link";
import { StepList } from "@/components/public/step-list";
import { employerSteps, workerSteps } from "@/lib/public/steps";

const columns = [
  { id: "home-workers", heading: "For workers", steps: workerSteps },
  { id: "home-employers", heading: "For employers", steps: employerSteps },
] as const;

export function HowItWorks({ lang }: { lang: string }) {
  return (
    <Band aria-labelledby="home-how-heading" className="grid gap-14">
      <h2 id="home-how-heading" className="font-serif text-section text-balance">
        How CHARA works
      </h2>
      <div className="grid gap-12 md:grid-cols-2 md:gap-16">
        {columns.map(({ id, heading, steps }) => (
          <section key={id} aria-labelledby={id} className="grid content-start gap-6 border-t border-brand pt-6">
            <h3 id={id} className="text-eyebrow text-brand-ink uppercase">
              {heading}
            </h3>
            <StepList steps={steps} compact />
          </section>
        ))}
      </div>
      <TextLink standalone href={`/${lang}/how-it-works`}>
        How CHARA works in detail
      </TextLink>
    </Band>
  );
}
