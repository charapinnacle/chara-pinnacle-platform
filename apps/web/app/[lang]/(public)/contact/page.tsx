import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { SettingDetails } from "@/components/public/setting-details";
import { getPublicSettings } from "@/lib/dal/settings";
import { CONTACT_FIELDS, settingRows } from "@/lib/public/setting-rows";

export const metadata: Metadata = {
  title: "Contact — CHARA",
  description: "How to reach CHARA, its privacy contact and its data-protection contact.",
};

export default async function ContactPage({ params }: PageProps<"/[lang]/contact">) {
  const [{ lang }, settings] = await Promise.all([params, getPublicSettings()]);
  return (
    <ContentPage title="Contact" lead="Write to us, or to the contacts for questions about your data.">
      <ContentSection heading="Contact details">
        <SettingDetails rows={settingRows(settings, CONTACT_FIELDS)} />
      </ContentSection>
      <ContentSection heading="Complaints">
        <p>
          To complain about a vacancy, an account or a decision, follow the{" "}
          <TextLink href={`/${lang}/legal/complaints-and-dispute-process`}>Complaints and Dispute Process</TextLink>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
