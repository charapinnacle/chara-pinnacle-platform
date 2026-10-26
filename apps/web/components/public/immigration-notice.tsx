import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { BRAND_NAME } from "@/lib/brand";
import { IMMIGRATION_DISCLAIMER_PATH } from "@/lib/public/navigation";

// FR-S4 AC10: where a visitor could assume advice (the public partner profile, a job order, Find Workers), a short notice
// links to the disclaimer. It asks for no acceptance: the disclaimer is shown, never consented to.
export function ImmigrationNotice({ lang, className }: { lang: string; className?: string }) {
  return (
    <Notice role="note" tone="info" className={className}>
      {BRAND_NAME} gives no immigration, visa or legal advice.{" "}
      <TextLink href={`/${lang}/${IMMIGRATION_DISCLAIMER_PATH}`}>Read the disclaimer</TextLink>
    </Notice>
  );
}
