import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { PageContainer } from "@/components/layout/page-container";

export const metadata: Metadata = { title: "Vacancy not available — CHARA" };

// The same page for a draft, a paused, closed or hidden vacancy and for an id that does not exist, so it tells a
// visitor nothing about which of them it is.
export default function JobNotFound() {
  return (
    <PageContainer layout="centered">
      <AuthCard title="This vacancy is no longer available">
        <TextLink standalone="flush" href="/">
          Back to the home page
        </TextLink>
      </AuthCard>
    </PageContainer>
  );
}
