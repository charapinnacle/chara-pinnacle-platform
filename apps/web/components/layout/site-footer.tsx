import { BrandMark, Wordmark } from "@/components/layout/brand";
import { PageContainer } from "@/components/layout/page-container";
import { copyrightLine } from "@/lib/brand";

// Dark because the monogram sits only on black (design-system.md section 0).
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
        <div className="flex flex-wrap items-center justify-between gap-x-6 border-t pt-6 text-caption">
          <p>{copyrightLine()}</p>
          {/* GeoNames licenses the city names of the City suggestions under CC BY 4.0, which asks for this credit. */}
          <p>
            City names from{" "}
            <a href="https://www.geonames.org" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground">
              GeoNames
            </a>
            , CC BY 4.0
          </p>
        </div>
      </PageContainer>
    </footer>
  );
}
