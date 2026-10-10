"use client";

import { LoadError } from "@/components/feedback/load-error";
import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";
import { SkipLink } from "@/components/layout/skip-link";
import { defaultLocale } from "@/lib/i18n/locale";
import "./globals.css";

// Replaces the root layout when it or a page that has no boundary of its own fails, so it brings its own document.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang={defaultLocale}>
      <body>
        <title>Something went wrong — CHARA</title>
        <SkipLink />
        <SiteShell homeHref={`/${defaultLocale}`}>
          <PageContainer layout="centered" className="max-w-3xl">
            <LoadError title="Something went wrong" retry={retry} homeHref={`/${defaultLocale}`} />
          </PageContainer>
        </SiteShell>
      </body>
    </html>
  );
}
