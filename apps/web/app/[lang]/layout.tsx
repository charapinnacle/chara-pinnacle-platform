import type { Metadata } from "next";
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
  const { lang } = await params;
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
