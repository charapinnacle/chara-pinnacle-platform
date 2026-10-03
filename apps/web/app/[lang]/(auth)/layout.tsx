import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";

export default function AuthLayout({ children }: LayoutProps<"/[lang]">) {
  return (
    <SiteShell>
      <PageContainer size="narrow" className="py-10 sm:py-16">
        {children}
      </PageContainer>
    </SiteShell>
  );
}
