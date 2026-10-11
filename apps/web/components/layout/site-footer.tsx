import { BrandMark, Wordmark } from "@/components/layout/brand";
import { PageContainer } from "@/components/layout/page-container";

// The dark foot of the public pages, the sign-in pages and the global pages, where the monogram sits on its own black.
export function SiteFooter({ links }: { links?: React.ReactNode }) {
  return (
    <footer className="bg-inverse text-small text-inverse-muted">
      <PageContainer className="grid gap-6 py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <span className="inline-flex shrink-0 items-center gap-3">
            <BrandMark />
            <Wordmark subline tone="inverse" />
          </span>
          {links}
        </div>
        <p className="border-t border-inverse-muted/20 pt-5">&copy; CHARA</p>
      </PageContainer>
    </footer>
  );
}
