import type { Metadata } from "next";
import { connection } from "next/server";
import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";
import { SkipLink } from "@/components/layout/skip-link";
import "./globals.css";

export const metadata: Metadata = { title: "Page not found — CHARA" };

export default async function GlobalNotFound() {
  await connection();
  return (
    <html lang="en">
      <body>
        <SkipLink />
        <SiteShell>
          <PageContainer className="py-16">
            <h1 className="text-4xl font-semibold tracking-tight">
              Page not found
            </h1>
          </PageContainer>
        </SiteShell>
      </body>
    </html>
  );
}
