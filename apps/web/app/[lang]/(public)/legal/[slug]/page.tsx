import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { SettingDetails } from "@/components/public/setting-details";
import { getLegalDocument } from "@/lib/dal/legal";
import { getPublicSettings } from "@/lib/dal/settings";
import { formatDate } from "@/lib/i18n/format";
import { PRIVACY_FIELDS, PRIVACY_POLICY_SLUG, settingRows } from "@/lib/public/setting-rows";
import { legalPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/legal/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const document = await getLegalDocument(slug);
  return document ? legalPageMetadata(lang, slug, document) : {};
}

export default async function LegalPage({
  params,
}: PageProps<"/[lang]/legal/[slug]">) {
  const { slug } = await params;
  const document = await getLegalDocument(slug);
  if (!document) notFound();
  const contacts = slug === PRIVACY_POLICY_SLUG ? settingRows(await getPublicSettings(), PRIVACY_FIELDS) : [];
  return (
    <PageContainer layout="page">
      <article className="grid max-w-[65ch] gap-8">
        <div className="grid gap-2 border-b pb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl sm:leading-tight">
            {document.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            Version {document.version}, published {formatDate(document.publishedAt)}
          </p>
        </div>
        <div className="text-base leading-7 whitespace-pre-line">{document.body}</div>
        {contacts.length > 0 ? (
          <section className="grid gap-3 border-t pt-6">
            <h2 className="text-xl font-semibold tracking-tight">Contacts for questions about your data</h2>
            <SettingDetails rows={contacts} />
          </section>
        ) : null}
      </article>
    </PageContainer>
  );
}
