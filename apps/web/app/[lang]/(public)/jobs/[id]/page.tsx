import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VacancyActions } from "@/components/jobs/vacancy-actions";
import { VacancyView } from "@/components/jobs/vacancy-view";
import { PageContainer } from "@/components/layout/page-container";
import { getPublicJob } from "@/lib/dal/hiring";
import { getCurrentUser } from "@/lib/dal/session";
import { jobPostingJsonLd } from "@/lib/jobs/job-posting";
import { logVacancy } from "@/lib/jobs/vacancy-log";
import { viewerOf } from "@/lib/jobs/viewer";
import { jobIdSchema } from "@/lib/validation/job";

async function loadJob(id: string) {
  const parsedId = jobIdSchema.safeParse(id);
  return parsedId.success ? getPublicJob(parsedId.data) : null;
}

// A vacancy that is not available has no title to show: the neutral not-found page of this route sets its own.
export async function generateMetadata({ params }: PageProps<"/[lang]/jobs/[id]">): Promise<Metadata> {
  const job = await loadJob((await params).id);
  return job ? { title: `${job.title} - ${job.employer.displayName} | CHARA` } : {};
}

// Rendered per request from the database (ADR-0004), so an edit is on the page at once. A vacancy that is not open and
// visible, an id that does not exist and an id that is not a uuid all end in the same notFound(), and a failed read
// throws instead: the error page, never "no longer available".
export default async function PublicJobPage({ params }: PageProps<"/[lang]/jobs/[id]">) {
  const { id } = await params;
  const [job, user] = await Promise.all([loadJob(id), getCurrentUser()]);
  const viewer = viewerOf(user);
  if (!job) {
    logVacancy({ event: "vacancy_view", outcome: "unavailable", viewer });
    notFound();
  }
  logVacancy({ event: "vacancy_view", outcome: "ok", jobId: job.id, viewer });
  return (
    <PageContainer layout="page" className="max-w-3xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jobPostingJsonLd(job) }} />
      <VacancyView
        job={job}
        employer={job.employer}
        publishedAt={job.publishedAt}
        actions={<VacancyActions jobId={job.id} viewer={viewer} />}
      />
    </PageContainer>
  );
}
