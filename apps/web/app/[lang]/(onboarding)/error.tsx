"use client";

import { LoadError } from "@/components/feedback/load-error";
import { defaultLocale } from "@/lib/i18n/locale";

export default function OnboardingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError title="This page could not be loaded" retry={retry} homeHref={`/${defaultLocale}`} />;
}
