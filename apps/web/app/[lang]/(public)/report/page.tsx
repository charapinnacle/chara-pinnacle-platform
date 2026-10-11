import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { TextLink } from "@/components/forms/text-link";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ReportForm } from "@/components/reports/report-form";
import { getPublicJob } from "@/lib/dal/hiring";
import { getCurrentUser } from "@/lib/dal/session";
import { contentPathFrom, vacancyIdFrom } from "@/lib/reports/target";

export const metadata: Metadata = { title: "Report - CHARA", robots: { index: false } };

const types = ["job", "company", "profile", "content"] as const;

const headings = {
  job: "Report a vacancy",
  company: "Report a company",
  profile: "Report a profile",
  content: "Report content",
} as const;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// The kind of report is in the address (?type=), and so is the target when the link comes from a page that knows it
// (?job= for a vacancy or a company, ?path= for a page). A vacancy that is not public is no target: the person then gives
// a link, and the database refuses what cannot be reported. Candidate profiles are private, so there is a note and no form.
export default async function ReportPage({ params, searchParams }: PageProps<"/[lang]/report">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  const type = z.enum(types).safeParse(first(query.type));
  if (!type.success) notFound();
  const kind = type.data;

  if (kind === "profile") {
    return (
      <PageContainer layout="page" className="grid max-w-3xl gap-6">
        <PageHeader title={headings.profile} />
        <p className="text-body">
          Candidate profiles are private, so there is nothing to report from the outside. If you belong to a company that
          received an application, open the applicant and choose &quot;Report this profile&quot; there.
        </p>
        <TextLink standalone href={`/${lang}/trust-safety`}>
          Back to Trust &amp; Safety
        </TextLink>
      </PageContainer>
    );
  }

  const [user, job] = await Promise.all([
    getCurrentUser(),
    kind === "content" ? null : getKnownJob(first(query.job)),
  ]);
  const path = kind === "content" ? contentPathFrom(first(query.path)) : null;
  const about =
    kind === "job" ? job && `${job.title}, ${job.employer.displayName}` : kind === "company" ? job?.employer.displayName : path;
  const target = kind === "content" ? (path ?? undefined) : job?.id;

  return (
    <PageContainer layout="page" className="grid max-w-3xl gap-8">
      <PageHeader title={headings[kind]}>
        {about ? <p className="text-body font-medium wrap-anywhere">{about}</p> : null}
      </PageHeader>
      <ReportForm lang={lang} type={kind} target={target} signedIn={user !== null} />
    </PageContainer>
  );
}

async function getKnownJob(value: string) {
  const id = vacancyIdFrom(value);
  return id ? getPublicJob(id) : null;
}
