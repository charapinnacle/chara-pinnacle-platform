import type { Metadata } from "next";
import { LegalExportButton } from "@/components/admin/legal-export-button";
import { LegalForm } from "@/components/admin/legal-form";
import { PageHeader } from "@/components/layout/page-header";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { FormButton } from "@/components/forms/form-button";
import { NativeSelect } from "@/components/forms/native-select";
import { TextLink } from "@/components/forms/text-link";
import { Section } from "@/components/layout/section";
import { acceptanceLine, inLegalDocumentGroup, legalDocumentGroup, legalDocumentGroups, type LegalDocumentGroup } from "@/lib/admin/legal-acceptance";
import { listLegalAcceptance, listLegalDocuments } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { formatShortDate } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Legal documents", robots: { index: false } };

function GroupFilter({ lang, group }: { lang: string; group: LegalDocumentGroup }) {
  return (
    <form action={adminPath(lang, "legal")} method="get" role="search" aria-label="Filter legal documents" className="flex flex-wrap items-end gap-3">
      <div className="grid gap-2 sm:w-64">
        <label htmlFor="legal-group-filter" className="text-small leading-snug font-medium">
          Documents
        </label>
        <NativeSelect id="legal-group-filter" name="group" defaultValue={group}>
          {Object.entries(legalDocumentGroups).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FormButton type="submit" variant="secondary" className="w-auto">
        Apply filter
      </FormButton>
    </form>
  );
}

export default async function LegalPage({ params, searchParams }: PageProps<"/[lang]/admin/legal">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["admin"]);
  const [all, acceptance] = await Promise.all([listLegalDocuments(), listLegalAcceptance()]);
  const group = legalDocumentGroup(query.group);
  const documents = all.filter((document) => inLegalDocumentGroup(document.slug, group));
  const chosen = typeof query.slug === "string" ? all.find((document) => document.slug === query.slug) : undefined;

  return (
    <div className="grid gap-page">
      <PageHeader title="Legal documents" />
      <Section id="current" title="Current versions" description="Version 0 is the draft placeholder until the first approved text is published.">
        <GroupFilter lang={lang} group={group} />
        <ResultsTable
          caption="Current versions of the legal documents"
          columns={["Document", "Title", "Version", "Status", "Published", "On the current version", "New version"]}
        >
          {documents.map((document) => (
            <tr key={document.slug}>
              <td className={`${cell} break-all`}>{document.slug}</td>
              <td className={`${cell} break-words`}>{document.title}</td>
              <td className={cell}>{document.version}</td>
              <td className={cell}>{document.isDraft ? "Draft" : "Approved"}</td>
              <td className={cell}>{formatShortDate(document.publishedAt)}</td>
              <td className={cell}>
                {acceptance.get(document.slug)?.map((row) => (
                  <span key={row.audience} className="block whitespace-nowrap">
                    {acceptanceLine(row)}
                  </span>
                )) ?? <span className="text-muted-foreground">Not in a sign-up list</span>}
              </td>
              <td className={cell}>
                <TextLink href={`${adminPath(lang, "legal")}?slug=${document.slug}#publish`}>
                  Publish<span className="sr-only"> a new version of {document.slug}</span>
                </TextLink>
              </td>
            </tr>
          ))}
        </ResultsTable>
        <div>
          <LegalExportButton href={`${adminPath(lang, "legal")}/export`} />
        </div>
      </Section>
      <Section
        id="publish"
        title="Publish a new version"
        description="The new version is public at once. Everyone who accepted the document gets an email and is asked to accept the new version at the next sign-in."
      >
        <LegalForm key={chosen?.slug ?? "new"} slug={chosen?.slug ?? ""} title={chosen?.title ?? ""} />
      </Section>
    </div>
  );
}
