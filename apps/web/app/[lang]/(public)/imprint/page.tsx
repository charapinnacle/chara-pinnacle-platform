import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { SettingDetails } from "@/components/public/setting-details";
import { getPublicSettings } from "@/lib/dal/settings";
import { IMPRINT_FIELDS, settingRows } from "@/lib/public/setting-rows";

export const metadata: Metadata = {
  title: "Imprint — CHARA",
  description: "The company that operates CHARA.",
};

export default async function ImprintPage() {
  const settings = await getPublicSettings();
  return (
    <ContentPage title="Imprint" lead="Information about the company that operates this website.">
      <ContentSection heading="Legal entity">
        <SettingDetails rows={settingRows(settings, IMPRINT_FIELDS)} />
      </ContentSection>
    </ContentPage>
  );
}
