import { LogoutButton } from "@/components/auth/logout-button";
import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";

export default function AppLayout({ children }: LayoutProps<"/[lang]">) {
  return (
    <SiteShell headerActions={<LogoutButton />}>
      <PageContainer layout="centered">{children}</PageContainer>
    </SiteShell>
  );
}
