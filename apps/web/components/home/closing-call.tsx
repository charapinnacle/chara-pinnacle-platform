import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { BRAND_NAME } from "@/lib/brand";
import { signUpPath } from "@/lib/routes";

// The client's closing line on the near-black of the brand, where the primary action is the gold one. Start hiring leads where
// the header's Post a Job does, and is left out for whom the header offers none.
export function ClosingCall({ lang, postJobHref }: { lang: string; postJobHref: string | null }) {
  return (
    <section aria-labelledby="home-start-heading" className="dark border-b bg-inverse text-foreground">
      <PageContainer className="grid justify-items-start gap-10 py-20 sm:py-28">
        <h2 id="home-start-heading" className="max-w-4xl text-section text-balance">
          Your Workforce. Your Network. One Platform.
        </h2>
        <div className="flex flex-wrap gap-3">
          <LinkButton href={signUpPath(lang)} prefetch={false} className="min-h-12">
            Join {BRAND_NAME}
          </LinkButton>
          {postJobHref ? (
            <LinkButton href={postJobHref} prefetch={false} variant="secondary" className="min-h-12 bg-transparent">
              Start hiring
            </LinkButton>
          ) : null}
        </div>
      </PageContainer>
    </section>
  );
}
