import { BrandLink } from "@/components/layout/brand";
import { PageContainer } from "@/components/layout/page-container";

export function SiteHeader({ actions, homeHref = "/" }: { actions?: React.ReactNode; homeHref?: string }) {
  return (
    <header className="border-b bg-background">
      <PageContainer className="flex min-h-16 flex-wrap items-center justify-between gap-x-6">
        <BrandLink href={homeHref} />
        {actions}
      </PageContainer>
    </header>
  );
}
