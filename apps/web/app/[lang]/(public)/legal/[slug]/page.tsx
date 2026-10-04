import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { getLegalDocument } from "@/lib/dal/legal";
import { formatDate } from "@/lib/i18n/format";

export default async function LegalPage({
  params,
}: PageProps<"/[lang]/legal/[slug]">) {
  const { slug } = await params;
  const document = await getLegalDocument(slug);
  if (!document) notFound();
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
      </article>
    </PageContainer>
  );
}
