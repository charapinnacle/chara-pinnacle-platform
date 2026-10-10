import Link from "next/link";
import { FooterGroup, FooterLinks, footerLinkVariants } from "@/components/layout/footer-links";
import { aboutLinks } from "@/lib/public/navigation";

// The footer of the public pages: the pages about CHARA first (the owner moved them out of the header), then the legal
// pages.
export function PublicFooterLinks({ lang }: { lang: string }) {
  return (
    <div className="grid gap-x-8 gap-y-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
      <nav aria-label="CHARA">
        <FooterGroup title="CHARA" tone="inverse">
          {aboutLinks.map(({ path, label }) => (
            <li key={path}>
              <Link href={`/${lang}/${path}`} prefetch={false} className={footerLinkVariants({ tone: "inverse" })}>
                {label}
              </Link>
            </li>
          ))}
        </FooterGroup>
      </nav>
      <FooterLinks lang={lang} tone="inverse" />
    </div>
  );
}
