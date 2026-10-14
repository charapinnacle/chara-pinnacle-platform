import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";

type ClosingAction = { href: string; label: string };

// The last call of the home and For employers pages on the near-black of the brand, centred, where the primary action is
// the gold one and a second action, when there is one, an outline.
export function ClosingCall({ id, title, primary, secondary }: { id: string; title: string; primary: ClosingAction | null; secondary?: ClosingAction | null }) {
  return (
    <section aria-labelledby={id} className="dark border-b bg-inverse text-foreground">
      <PageContainer className="grid justify-items-center gap-10 py-20 text-center sm:py-28 lg:py-36">
        <h2 id={id} className="max-w-[16ch] text-section text-balance">
          {title}
        </h2>
        {primary || secondary ? (
          <div className="flex flex-wrap justify-center gap-3.5">
            {primary ? (
              <LinkButton href={primary.href} prefetch={false} className="min-h-12 px-6">
                {primary.label}
              </LinkButton>
            ) : null}
            {secondary ? (
              <LinkButton href={secondary.href} prefetch={false} variant="secondary" className="min-h-12 bg-transparent px-6">
                {secondary.label}
              </LinkButton>
            ) : null}
          </div>
        ) : null}
      </PageContainer>
    </section>
  );
}
