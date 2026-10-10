import { AuthBrandPanel } from "@/components/layout/auth-brand-panel";
import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";

export default function AuthLayout({ children }: LayoutProps<"/[lang]">) {
  return (
    <SiteShell>
      <PageContainer layout="centered">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <AuthBrandPanel />
          <div className="animate-rise">{children}</div>
        </div>
      </PageContainer>
    </SiteShell>
  );
}
