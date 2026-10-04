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
    <PageContainer className="grid max-w-3xl gap-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{document.title}</h1>
      <p className="text-sm text-muted-foreground">
        Version {document.version}, published {formatDate(document.publishedAt)}
      </p>
      <div className="whitespace-pre-line">{document.body}</div>
    </PageContainer>
  );
}
