import { FooterLinks } from "@/components/layout/footer-links";
import { PublicNav } from "@/components/layout/public-nav";
import { SiteShell } from "@/components/layout/site-shell";

export default async function PublicLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <SiteShell headerActions={<PublicNav lang={lang} />} footerLinks={<FooterLinks lang={lang} />}>
      {children}
    </SiteShell>
  );
}
