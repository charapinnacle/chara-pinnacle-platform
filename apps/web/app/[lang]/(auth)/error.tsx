"use client";

import { LoadError } from "@/components/feedback/load-error";
import { defaultLocale } from "@/lib/i18n/locale";

export default function AuthError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <LoadError title="This page could not be loaded" retry={retry} homeHref={`/${defaultLocale}`} />
    </div>
  );
}
