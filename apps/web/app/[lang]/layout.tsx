import type { Metadata } from "next";
import { connection } from "next/server";
import { Toaster } from "@/components/feedback/toaster";
import { SkipLink } from "@/components/layout/skip-link";
import { BRAND_NAME } from "@/lib/brand";
import { env } from "@/lib/env";
import { geist } from "@/lib/fonts";
import { staticPages } from "@/lib/seo/pages";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  // A page names only itself ("Settings"); the template adds the product name. Pages with search metadata set an
  // absolute title (lib/seo/metadata.ts).
  title: { default: staticPages.home.title, template: `%s — ${BRAND_NAME}` },
  description: `${BRAND_NAME} connects workers, employers, recruitment companies and staffing companies.`,
  // This openGraph replaces the one inherited from app/opengraph-image.tsx whole, so the image is named again.
  openGraph: { siteName: BRAND_NAME, images: "/opengraph-image" },
};

// English only in Phase 1; any other first segment is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ lang: "en" }];
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  // Every response needs its own CSP nonce, so no page is prerendered (ADR-0004).
  await connection();
  const { lang } = await params;
  return (
    <html lang={lang} className={geist.variable}>
      <body>
        <SkipLink />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
