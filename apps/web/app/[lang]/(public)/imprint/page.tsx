import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { SettingDetails } from "@/components/public/setting-details";
import { TextLink } from "@/components/forms/text-link";
import { BRAND_NAME } from "@/lib/brand";
import { getPublicSettings } from "@/lib/dal/settings";
import { PHOTO_CREDITS_ID } from "@/lib/public/navigation";
import { photos } from "@/lib/public/photos";
import { IMPRINT_FIELDS, settingRows } from "@/lib/public/setting-rows";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/imprint">): Promise<Metadata> {
  return staticPageMetadata("imprint", (await params).lang);
}

export default async function ImprintPage() {
  const settings = await getPublicSettings();
  return (
    <ContentPage title="Imprint" lead="Information about the company that operates this website.">
      <ContentSection heading="Legal entity">
        <SettingDetails rows={settingRows(settings, IMPRINT_FIELDS)} />
      </ContentSection>
      <ContentSection heading="Photo credits" id={PHOTO_CREDITS_ID}>
        <p>
          The photographs on the home page are from Unsplash and used under the{" "}
          <TextLink href="https://unsplash.com/license">Unsplash License</TextLink>. The people shown illustrate industries; they
          are not customers or workers of {BRAND_NAME}.
        </p>
        <ul className="grid gap-1">
          {Object.values(photos).map(({ subject, photographer, page }) => (
            <li key={page}>
              {subject}: <TextLink href={page}>{photographer}</TextLink>
            </li>
          ))}
        </ul>
      </ContentSection>
    </ContentPage>
  );
}
