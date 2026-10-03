import type { Metadata } from "next";
import { connection } from "next/server";
import { Toaster } from "@/components/feedback/toaster";
import { SkipLink } from "@/components/layout/skip-link";
import "../globals.css";

export const metadata: Metadata = {
  title: "CHARA — The Global Workforce Network",
  description:
    "CHARA connects workers, employers, recruitment companies and staffing companies.",
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
    <html lang={lang}>
      <body>
        <SkipLink />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
