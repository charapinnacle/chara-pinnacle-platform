import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { staticPageMetadata } from "@/lib/seo/metadata";
import { BRAND_NAME } from "@/lib/brand";

export async function generateMetadata({ params }: PageProps<"/[lang]/about">): Promise<Metadata> {
  return staticPageMetadata("about", (await params).lang);
}

export default async function AboutPage({ params }: PageProps<"/[lang]/about">) {
  const { lang } = await params;
  return (
    <ContentPage title={`About ${BRAND_NAME}`} lead="Building the Global Workforce Network">
      <ContentSection heading={`Who ${BRAND_NAME} connects`}>
        <p>
          {BRAND_NAME} connects workers and employers. The platform lets them discover one another, create structured profiles,
          find opportunities and build professional connections. Recruitment companies and staffing companies follow in
          a later phase.
        </p>
      </ContentSection>
      <ContentSection heading="How we work">
        <p>
          Privacy is the default, vacancies are listed by the same rules for everyone, and the rules of the platform
          are public.
        </p>
      </ContentSection>
      <ContentSection heading={`Who is behind ${BRAND_NAME}`}>
        <p>
          The details of the company that operates {BRAND_NAME} are on the <TextLink href={`/${lang}/imprint`}>Imprint</TextLink>{" "}
          page. To reach us, see <TextLink href={`/${lang}/contact`}>Contact</TextLink>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
