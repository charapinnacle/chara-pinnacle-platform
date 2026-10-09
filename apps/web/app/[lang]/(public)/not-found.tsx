import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { PageContainer } from "@/components/layout/page-container";
import { defaultLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Page not found — CHARA",
  robots: { index: false, follow: false },
};

export default function PublicNotFound() {
  return (
    <PageContainer layout="centered">
      <AuthCard title="Page not found">
        <TextLink standalone="flush" href={`/${defaultLocale}`}>
          Back to the home page
        </TextLink>
      </AuthCard>
    </PageContainer>
  );
}
