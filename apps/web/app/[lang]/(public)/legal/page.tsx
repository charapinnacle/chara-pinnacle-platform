import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { listCurrentLegalDocuments } from "@/lib/dal/legal";
import { formatDate } from "@/lib/i18n/format";
import { legalGroups, legalSlugs } from "@/lib/public/navigation";

export const metadata: Metadata = { title: "All legal documents — CHARA" };

// Every legal document is two clicks from every page: the footer links here, and this page links to each document.
// A document without a published version has no row, as its page would be a 404; the Imprint has no version.
export default async function LegalIndexPage({ params }: PageProps<"/[lang]/legal">) {
  const [{ lang }, current] = await Promise.all([params, listCurrentLegalDocuments(legalSlugs)]);
  return (
    <ContentPage title="All legal documents" lead="The current version of every document, with the date it was published.">
      {legalGroups.map(({ title, links }) => (
        <ContentSection key={title} heading={title}>
          <ul className="grid gap-4">
            {links.flatMap(({ path, label }) => {
              const slug = path.startsWith("legal/") ? path.slice("legal/".length) : null;
              const version = slug ? current.get(slug) : null;
              if (slug && !version) return [];
              return [
                <li key={path} className="grid gap-0.5">
                  <TextLink href={`/${lang}/${path}`}>{label}</TextLink>
                  {version ? (
                    <p className="text-small text-muted-foreground">
                      Version {version.version} · Published {formatDate(version.publishedAt)}
                      {version.isDraft ? " · Draft" : ""}
                    </p>
                  ) : null}
                </li>,
              ];
            })}
          </ul>
        </ContentSection>
      ))}
    </ContentPage>
  );
}
