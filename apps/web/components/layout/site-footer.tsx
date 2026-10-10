import { BrandMark, Wordmark } from "@/components/layout/brand";
import { PageContainer } from "@/components/layout/page-container";

// The dark foot of the public pages, the sign-in pages and the global pages, where the monogram sits on its own black.
export function SiteFooter({ links }: { links?: React.ReactNode }) {
  return (
    <footer className="bg-inverse text-small text-inverse-muted">
      <PageContainer className="grid gap-10 py-12 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
          <div className="grid content-start gap-4">
            <span className="inline-flex items-center gap-3">
              <BrandMark />
              <Wordmark subline tone="inverse" />
            </span>
            <p className="max-w-xs">The global workforce network: one profile for workers, one pipeline for employers.</p>
          </div>
          {links}
        </div>
        <p className="border-t border-inverse-muted/20 pt-6">&copy; CHARA</p>
      </PageContainer>
    </footer>
  );
}
