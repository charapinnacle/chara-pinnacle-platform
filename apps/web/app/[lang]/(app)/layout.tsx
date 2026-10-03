import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";

export default function AppLayout({ children }: LayoutProps<"/[lang]">) {
  return (
    <SiteShell>
      <PageContainer className="py-8">{children}</PageContainer>
    </SiteShell>
  );
}
