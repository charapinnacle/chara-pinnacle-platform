import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { PageContainer } from "@/components/layout/page-container";
import { defaultLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Profile not available",
  robots: { index: false, follow: false },
};

// The same page for a partner in review, declined, suspended or hidden, an employer's slug and a slug that does not
// exist, so it tells a visitor nothing about which of them it is (FR-K4 AC2).
export default function PartnerNotFound() {
  return (
    <PageContainer layout="centered">
      <AuthCard title="This profile is not available">
        <TextLink standalone="flush" href={`/${defaultLocale}`}>
          Go to the home page
        </TextLink>
      </AuthCard>
    </PageContainer>
  );
}
