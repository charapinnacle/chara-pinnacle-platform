import { Band } from "@/components/home/band";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { BRAND_NAME } from "@/lib/brand";
import { employerSteps, workerSteps, type Step } from "@/lib/public/steps";
import { signUpPath } from "@/lib/routes";

// The two user types of Phase 1 in the order of the client's structure, each with the steps of How it works for its side
// (one source, so the two pages never differ) and one fact the product enforces. Recruitment and staffing companies are a
// later phase and are not offered.
const audiences = [
  {
    id: "home-employer-heading",
    title: "Employer",
    line: "Find the workforce you need.",
    steps: employerSteps,
    fact: "Two-step verification is required for owners and administrators.",
    kind: "company",
    action: "I'm an employer",
  },
  {
    id: "home-worker-heading",
    title: "Worker",
    line: "Find jobs and build your professional workforce profile.",
    steps: workerSteps,
    fact: "Workers never pay.",
    kind: "worker",
    action: "I'm a worker",
  },
] as const;

function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="grid">
      {steps.map(({ title, text }, index) => (
        <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] border-t py-4">
          <span aria-hidden className="text-small leading-6 font-semibold text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <span className="grid gap-1">
            <span className="text-h3">{title}</span>
            <span className="text-small text-muted-foreground">{text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function WhoAreYou({ lang }: { lang: string }) {
  return (
    <Band aria-labelledby="home-who-heading" className="grid gap-12 sm:gap-16">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4">
        <h2 id="home-who-heading" className="text-section">
          Who are you?
        </h2>
        <TextLink standalone="flush" href={`/${lang}/how-it-works`} prefetch={false}>
          How {BRAND_NAME} works
        </TextLink>
      </div>
      <div className="grid gap-16 md:grid-cols-2 md:grid-rows-[auto_auto_auto] md:gap-0 md:divide-x">
        {audiences.map(({ id, title, line, steps, fact, kind, action }) => (
          <section key={id} aria-labelledby={id} className="grid content-start gap-8 md:row-span-3 md:grid-rows-subgrid md:first:pe-8 md:last:ps-8 lg:first:pe-12 lg:last:ps-12">
            <div className="grid gap-2">
              <h3 id={id} className="text-h1">
                {title}
              </h3>
              <p className="text-lead text-muted-foreground">{line}</p>
            </div>
            <Steps steps={steps} />
            <div className="grid content-start justify-items-start gap-6">
              <p className="text-small font-medium">{fact}</p>
              <LinkButton href={signUpPath(lang, kind)} prefetch={false}>
                {action}
              </LinkButton>
            </div>
          </section>
        ))}
      </div>
    </Band>
  );
}
