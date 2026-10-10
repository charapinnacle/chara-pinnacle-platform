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
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/[lang]/legal/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const document = await getLegalDocument(slug);
  return document ? legalPageMetadata(lang, slug, document) : {};
}

type Heading = { id: string; text: string };

// A long text gets a list of its sections beside it from 1024 px (above it on a phone); a short one does not need it.
const CONTENTS_FROM = 3;

function Contents({ headings }: { headings: Heading[] }) {
  return (
    <nav aria-labelledby="legal-contents" className="grid content-start gap-3 rounded-xl border bg-card p-card text-small lg:sticky lg:top-8 lg:border-0 lg:bg-transparent lg:p-0">
      <h2 id="legal-contents" className="text-eyebrow text-brand-ink uppercase">
        On this page
      </h2>
      <ol className="grid gap-1 lg:border-s">
        {headings.map(({ id, text }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="-ms-px inline-flex min-h-9 items-center border-s-2 border-transparent ps-3 text-muted-foreground transition-colors duration-150 hover:border-brand hover:text-foreground"
            >
              {text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default async function LegalPage({
  params,
}: PageProps<"/[lang]/legal/[slug]">) {
  const { slug } = await params;
  const document = await getLegalDocument(slug);
  if (!document) notFound();
  const contacts = slug === PRIVACY_POLICY_SLUG ? settingRows(await getPublicSettings(), PRIVACY_FIELDS) : [];
  let sections = 0;
  const blocks = parseLegalBody(document.body).map((block) =>
    block.kind === "heading" ? { ...block, id: `section-${++sections}` } : { ...block, id: null },
  );
  const headings = blocks.flatMap(({ kind, id, text }) => (kind === "heading" && id ? [{ id, text }] : []));
  const withContents = headings.length >= CONTENTS_FROM;
  return (
    <PageContainer layout="page">
      <article
        className={cn(
          "grid max-w-[65ch] animate-rise gap-8",
          withContents && "lg:max-w-none lg:grid-cols-[minmax(0,65ch)_14rem] lg:justify-between lg:gap-x-16",
        )}
      >
        <PageHeader size="display" title={document.title} className="gap-2 border-b pb-6 lg:col-start-1">
          <p className="text-small text-muted-foreground">
            Version {document.version} · Published {formatLegalDate(document.publishedAt)}
          </p>
          <p className="text-small leading-6">
            <span className="font-medium">What changed:</span> {document.changeSummary}
          </p>
        </PageHeader>
        {withContents ? (
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <Contents headings={headings} />
          </div>
        ) : null}
        <div className="grid content-start gap-8 lg:col-start-1">
          {document.isDraft ? <Notice role="note">Draft - not yet approved by legal counsel</Notice> : null}
          <div className="grid gap-4 text-base leading-7">
            {blocks.map((block, index) =>
              block.kind === "heading" ? (
                <h2 key={index} id={block.id ?? undefined} className="mt-4 scroll-mt-8 text-h2">
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
        </div>
      </article>
    </PageContainer>
  );
}
