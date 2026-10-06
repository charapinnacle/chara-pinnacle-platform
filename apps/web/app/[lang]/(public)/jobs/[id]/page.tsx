import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VacancyView } from "@/components/jobs/vacancy-view";
import { PageContainer } from "@/components/layout/page-container";
import { getPublicJob } from "@/lib/dal/hiring";
import { jobIdSchema } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Vacancy — CHARA" };

export default async function PublicJobPage({ params }: PageProps<"/[lang]/jobs/[id]">) {
  const { id } = await params;
  const parsedId = jobIdSchema.safeParse(id);
  const job = parsedId.success ? await getPublicJob(parsedId.data) : null;
  if (!job) notFound();
  return (
    <PageContainer layout="page" className="max-w-3xl">
      <VacancyView job={job} />
    </PageContainer>
  );
}
