import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { PageContainer } from "@/components/layout/page-container";
import { defaultLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "Vacancy not available | CHARA",
  robots: { index: false, follow: false },
};

// The same page for a draft, a paused, closed or hidden vacancy and for an id that does not exist, so it tells a
// visitor nothing about which of them it is.
export default function JobNotFound() {
  return (
    <PageContainer layout="centered">
      <AuthCard title="This vacancy is no longer available">
        <TextLink standalone="flush" href={`/${defaultLocale}/jobs`}>
          Find jobs
        </TextLink>
      </AuthCard>
    </PageContainer>
  );
}
