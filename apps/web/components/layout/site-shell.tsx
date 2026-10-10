import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export function SiteShell({
  children,
  headerActions,
  footerLinks,
  homeHref,
}: {
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  footerLinks?: React.ReactNode;
  homeHref?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader actions={headerActions} homeHref={homeHref} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
      <SiteFooter links={footerLinks} />
    </div>
  );
}
