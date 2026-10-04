import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";

export default function AuthLayout({ children }: LayoutProps<"/[lang]">) {
  return (
    <SiteShell>
      <PageContainer layout="centered">{children}</PageContainer>
    </SiteShell>
  );
}
