import { BrandMark, Wordmark } from "@/components/layout/brand";
import { PageContainer } from "@/components/layout/page-container";

// The dark foot of the public pages, the sign-in pages and the global pages, where the monogram sits on its own black: the
// logo, the links of the area (three columns on the public pages) and one quiet line under a hairline.
export function SiteFooter({ links }: { links?: React.ReactNode }) {
  return (
    <footer className="dark bg-inverse text-small text-muted-foreground">
      <PageContainer className="grid gap-10 py-12 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
          <span className="inline-flex shrink-0 items-start gap-3">
            <BrandMark />
            <Wordmark subline tone="inverse" />
          </span>
          {links}
        </div>
        <p className="border-t pt-6 text-caption">&copy; CHARA</p>
      </PageContainer>
    </footer>
  );
}
