import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";

export const metadata: Metadata = {
  title: "About — CHARA",
  description: "What CHARA is and who stands behind it.",
};

export default async function AboutPage({ params }: PageProps<"/[lang]/about">) {
  const { lang } = await params;
  return (
    <ContentPage
      title="About CHARA"
      lead="CHARA is a workforce network where workers and employers meet."
    >
      <ContentSection heading="What we do">
        <p>
          We give workers one place to present themselves and apply for work, and employers one place to publish
          vacancies and manage applicants. Workers never pay to use CHARA.
        </p>
      </ContentSection>
      <ContentSection heading="How we work">
        <p>
          Privacy is the default, vacancies are listed by the same rules for everyone, and the rules of the platform
          are public.
        </p>
      </ContentSection>
      <ContentSection heading="Who is behind CHARA">
        <p>
          The details of the company that operates CHARA are on the <TextLink href={`/${lang}/imprint`}>Imprint</TextLink>{" "}
          page. To reach us, see <TextLink href={`/${lang}/contact`}>Contact</TextLink>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
