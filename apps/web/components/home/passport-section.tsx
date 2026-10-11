import { Band } from "@/components/home/band";
import { PassportPreview } from "@/components/home/passport-preview";
import { LinkButton } from "@/components/layout/link-button";
import { signUpPath } from "@/lib/routes";

export function PassportSection({ lang }: { lang: string }) {
  return (
    <Band tone="dark" aria-labelledby="home-passport-heading" className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
      <div className="grid content-center justify-items-start gap-6">
        <h2 id="home-passport-heading" className="font-serif text-section text-balance">
          One professional profile. Multiple opportunities.
        </h2>
        <p className="max-w-[40ch] text-lead text-pretty text-muted-foreground">
          Create your CHARA Passport once and use it for every application.
        </p>
        <LinkButton href={signUpPath(lang, "worker")} className="lift mt-2">
          Create CHARA Passport
        </LinkButton>
      </div>
      <PassportPreview />
    </Band>
  );
}
