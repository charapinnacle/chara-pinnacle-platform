import type { Metadata } from "next";
import { connection } from "next/server";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
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
          <PageContainer layout="centered">
            <AuthCard title="Page not found">
              <TextLink href="/" className="justify-self-start">
                Back to the home page
              </TextLink>
            </AuthCard>
          </PageContainer>
        </SiteShell>
      </body>
    </html>
  );
}
