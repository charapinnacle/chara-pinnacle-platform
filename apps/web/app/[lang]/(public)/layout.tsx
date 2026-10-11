import { FooterLinks } from "@/components/layout/footer-links";
import { PublicNav } from "@/components/layout/public-nav";
import { SiteShell } from "@/components/layout/site-shell";
import { publicFooterLinks } from "@/lib/public/navigation";

export default async function PublicLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <SiteShell headerActions={<PublicNav lang={lang} />} footerLinks={<FooterLinks lang={lang} label="Footer" links={publicFooterLinks} tone="inverse" />}>
      {children}
    </SiteShell>
  );
}
