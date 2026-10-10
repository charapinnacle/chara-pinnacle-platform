import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { SettingDetails } from "@/components/public/setting-details";
import { getLegalDocument } from "@/lib/dal/legal";
import { getPublicSettings } from "@/lib/dal/settings";
import { formatLegalDate } from "@/lib/i18n/format";
import { parseLegalBody } from "@/lib/public/legal-body";
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
        <PageHeader size="display" title={document.title} className="gap-2 border-b pb-6">
          <p className="text-small text-muted-foreground">
            Version {document.version} · Published {formatLegalDate(document.publishedAt)}
          </p>
          <p className="text-small leading-6">
            <span className="font-medium">What changed:</span> {document.changeSummary}
          </p>
        </PageHeader>
        {document.isDraft ? <Notice role="note">Draft - not yet approved by legal counsel</Notice> : null}
        <div className="grid gap-4 text-base leading-7">
          {parseLegalBody(document.body).map((block, index) =>
            block.kind === "heading" ? (
              <h2 key={index} className="mt-4 text-h2">
                {block.text}
              </h2>
            ) : (
              <p key={index} className="whitespace-pre-line">
                {block.text}
              </p>
            ),
          )}
        </div>
        {contacts.length > 0 ? (
          <section className="grid gap-3 border-t pt-6">
            <h2 className="text-h2">Contacts for questions about your data</h2>
            <SettingDetails rows={contacts} />
          </section>
        ) : null}
        <section aria-labelledby="change-log" className="grid gap-3 border-t pt-6">
          <h2 id="change-log" className="text-h2">
            Change log
          </h2>
          <ol className="grid gap-4">
            {document.changeLog.map((entry) => (
              <li key={entry.version} className="grid gap-1">
                <p className="text-small font-medium">
                  Version {entry.version} · {formatLegalDate(entry.publishedAt)}
                  {entry.isDraft ? " · Draft" : ""}
                </p>
                <p className="text-small leading-6 text-muted-foreground">{entry.changeSummary}</p>
              </li>
            ))}
          </ol>
          {document.changeLogTruncated ? (
            <p className="text-small text-muted-foreground">Older versions are available on request.</p>
          ) : null}
        </section>
      </article>
    </PageContainer>
  );
}
