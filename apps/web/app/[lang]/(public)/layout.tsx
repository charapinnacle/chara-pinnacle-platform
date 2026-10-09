import { PublicFooterLinks } from "@/components/layout/public-footer-links";
import { PublicNav } from "@/components/layout/public-nav";
import { SiteShell } from "@/components/layout/site-shell";

export default async function PublicLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <SiteShell headerActions={<PublicNav lang={lang} />} footerLinks={<PublicFooterLinks lang={lang} />}>
      {children}
    </SiteShell>
  );
}
