import type { Metadata } from "next";
import { LegalForm } from "@/components/admin/legal-form";
import { PageHeading } from "@/components/admin/page-heading";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { TextLink } from "@/components/forms/text-link";
import { PassportSection } from "@/components/passport/section";
import { listLegalDocuments } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { formatShortDate } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Legal documents — CHARA", robots: { index: false } };

export default async function LegalPage({ params, searchParams }: PageProps<"/[lang]/admin/legal">) {
  const [{ lang }, { slug }] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["admin"]);
  const documents = await listLegalDocuments();
  const chosen = typeof slug === "string" ? documents.find((document) => document.slug === slug) : undefined;

  return (
    <div className="grid gap-6">
      <PageHeading title="Legal documents" />
      <PassportSection id="current" title="Current versions" description="Version 0 is the draft placeholder until the first approved text is published.">
        <ResultsTable caption="Current versions of the legal documents" columns={["Document", "Title", "Version", "Published", "New version"]}>
          {documents.map((document) => (
            <tr key={document.slug}>
              <td className={`${cell} break-all`}>{document.slug}</td>
              <td className={`${cell} break-words`}>{document.title}</td>
              <td className={cell}>{document.version}</td>
              <td className={cell}>{formatShortDate(document.publishedAt)}</td>
              <td className={cell}>
                <TextLink href={`${adminPath(lang, "legal")}?slug=${document.slug}#publish`}>
                  Publish<span className="sr-only"> a new version of {document.slug}</span>
                </TextLink>
              </td>
            </tr>
          ))}
        </ResultsTable>
      </PassportSection>
      <PassportSection
        id="publish"
        title="Publish a new version"
        description="The new version is public at once. Everyone who has to accept the document gets an email and is asked to accept it at the next sign-in."
      >
        <LegalForm key={chosen?.slug ?? "new"} slug={chosen?.slug ?? ""} title={chosen?.title ?? ""} />
      </PassportSection>
    </div>
  );
}
