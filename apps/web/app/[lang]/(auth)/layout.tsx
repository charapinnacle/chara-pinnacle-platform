import { AuthBrandPanel } from "@/components/layout/auth-brand-panel";
import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";

export default function AuthLayout({ children }: LayoutProps<"/[lang]">) {
  return (
    <SiteShell>
      <PageContainer layout="centered">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start xl:gap-20">
          <AuthBrandPanel />
          <div className="animate-rise lg:flex lg:min-h-[34rem] lg:flex-col lg:justify-center">{children}</div>
        </div>
      </PageContainer>
    </SiteShell>
  );
}
