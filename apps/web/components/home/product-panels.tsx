import { LinkButton } from "@/components/layout/link-button";
import { Band } from "@/components/home/band";
import { PassportPreview } from "@/components/home/passport-preview";
import { Photo } from "@/components/home/photo";
import { PipelinePreview } from "@/components/home/pipeline-preview";
import { signUpPath } from "@/lib/routes";

type PanelTextProps = { id: string; eyebrow: string; heading: string; text: string; children: React.ReactNode };

function PanelText({ id, eyebrow, heading, text, children }: PanelTextProps) {
  return (
    <div className="grid content-center justify-items-start gap-5">
      <p className="text-eyebrow text-brand-ink uppercase">{eyebrow}</p>
      <h2 id={id} className="font-serif text-section text-balance">
        {heading}
      </h2>
      <p className="max-w-[44ch] text-lead text-pretty text-muted-foreground">{text}</p>
      <div className="pt-2">{children}</div>
    </div>
  );
}

// One panel per side of the platform, each with a rendering of the screen it leads to. Only what Phase 1 does is said.
export function ProductPanels({ lang }: { lang: string }) {
  return (
    <>
      <Band tone="dark" aria-labelledby="home-employers-heading" className="grid items-center gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
        <PanelText
          id="home-employers-heading"
          eyebrow="For employers"
          heading="Publish a vacancy and manage every applicant in one pipeline"
          text="Move applicants from Applied to Hired on one board, shortlist the strongest and invite your team to review."
        >
          <LinkButton href={signUpPath(lang, "company")} prefetch={false} className="lift">
            Post a Job
          </LinkButton>
        </PanelText>
        <div className="relative isolate grid ps-6 pt-[46%] sm:ps-16">
          <div className="absolute start-0 end-10 top-0 -z-10 aspect-[3/2] overflow-hidden rounded-2xl bg-inverse sm:end-20">
            <Photo name="employers-handshake" sizes="(min-width: 64rem) 560px, 90vw" className="opacity-85" />
          </div>
          <PipelinePreview />
        </div>
      </Band>
      <Band tone="light" aria-labelledby="home-workers-heading" className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <div className="lg:order-last">
          <PanelText
            id="home-workers-heading"
            eyebrow="For workers"
            heading="One CHARA Passport for every application"
            text="Describe your occupation, experience, skills and languages once, apply with it in a few clicks and follow each application stage by stage. Workers never pay."
          >
            <LinkButton href={signUpPath(lang, "worker")} prefetch={false} className="lift">
              Create your passport
            </LinkButton>
          </PanelText>
        </div>
        <PassportPreview />
      </Band>
    </>
  );
}
