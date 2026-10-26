import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { PageContainer } from "@/components/layout/page-container";
import { defaultLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Page not available",
  robots: { index: false, follow: false },
};

// The same page for a company page that is off, a suspended employer and a slug that does not exist, so it tells a
// visitor nothing about which of them it is (FR-K5 AC1, AC6).
export default function CompanyNotFound() {
  return (
    <PageContainer layout="centered">
      <AuthCard title="This company page is not available">
        <TextLink standalone="flush" href={`/${defaultLocale}`}>
          Go to the home page
        </TextLink>
      </AuthCard>
    </PageContainer>
  );
}
