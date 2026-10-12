import { Band } from "@/components/home/band";
import { LinkButton } from "@/components/layout/link-button";
import { signUpPath } from "@/lib/routes";
import { BRAND_NAME } from "@/lib/brand";

export function ClosingCall({ lang }: { lang: string }) {
  return (
    <Band tone="dark" textured aria-labelledby="home-start-heading" className="grid justify-items-center gap-10 text-center">
      <h2 id="home-start-heading" className="max-w-4xl font-serif text-section text-balance">
        Your Workforce. Your Network. One Platform.
      </h2>
      <div className="flex flex-wrap justify-center gap-3">
        <LinkButton href={signUpPath(lang, "worker")} className="lift">
          Join {BRAND_NAME}
        </LinkButton>
        <LinkButton href={signUpPath(lang, "company")} variant="secondary" className="lift bg-transparent hover:bg-secondary">
          Start hiring
        </LinkButton>
      </div>
    </Band>
  );
}
