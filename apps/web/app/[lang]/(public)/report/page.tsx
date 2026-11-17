import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { TextLink } from "@/components/forms/text-link";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ReportForm } from "@/components/reports/report-form";
import { getPublicJob } from "@/lib/dal/hiring";
import { getPartnerProfile } from "@/lib/dal/partner-profile";
import { isReleased, type ReleaseSwitch } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { contentPathFrom, vacancyIdFrom } from "@/lib/reports/target";
import { loginPath, reportPath } from "@/lib/routes";
import { isReportItem, reportCategorySchema, reportTargetTypes, type ReportItemType } from "@/lib/validation/report";
import { slugSchema } from "@/lib/validation/team";

export const metadata: Metadata = { title: "Report", robots: { index: false } };

const headings = {
  job: "Report a vacancy",
  company: "Report a company",
  profile: "Report a profile",
  content: "Report content",
  partner_profile: "Report a company",
  requirement: "Report a job order",
  partner_response: "Report a response",
  candidate_submission: "Report a submission",
} as const;

// The release each item of the job order network belongs to; while it is off the form is not found.
const itemReleases = {
  requirement: "release_job_orders",
  partner_response: "release_job_orders",
  candidate_submission: "release_candidate_submissions",
} as const satisfies Record<ReportItemType, ReleaseSwitch>;

const itemParams = { requirement: "requirement", partner_response: "response", candidate_submission: "submission" } as const satisfies Record<
  ReportItemType,
  string
>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// The kind of report is in the address (?type=), and so is the target when the link comes from a page that knows it
// (?job= for a vacancy or a company, ?path= for a page, ?partner= for the slug of a partner profile) and a category to
// preselect (?category=). A vacancy that is not public is no target: the person then gives a link, and the database
// refuses what cannot be reported. Candidate profiles are private, so there is a note and no form. A partner profile is
// reported from its page only, and only while release 2a is on. A job order, a response or a submission (?requirement=,
// ?response=, ?submission=) is reported by a signed-in participant from its page, while its release is on.
export default async function ReportPage({ params, searchParams }: PageProps<"/[lang]/report">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  const type = z.enum(reportTargetTypes).safeParse(first(query.type));
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

  const category = reportCategorySchema.safeParse(first(query.category)).data;

  if (isReportItem(kind)) {
    const id = z.uuid().safeParse(first(query[itemParams[kind]]));
    const [released, user] = await Promise.all([isReleased(itemReleases[kind]), getCurrentUser()]);
    if (!id.success || !released) notFound();
    return (
      <PageContainer layout="page" className="grid max-w-3xl gap-8">
        <PageHeader title={headings[kind]} />
        {user ? (
          <ReportForm lang={lang} type={kind} target={id.data} category={category} signedIn />
        ) : (
          <p className="text-body">
            Only the people who take part in it can report it.{" "}
            <TextLink href={loginPath(lang, reportPath(lang, kind, id.data, category))}>Log in to report it</TextLink>
          </p>
        )}
      </PageContainer>
    );
  }

  if (kind === "partner_profile") {
    const partner = slugSchema.safeParse(first(query.partner));
    const [released, user] = await Promise.all([isReleased("release_partner_directories"), getCurrentUser()]);
    if (!partner.success || !released) notFound();
    // The company is named as its profile names it; a profile that is not public names nothing, and the database refuses
    // the report.
    const profile = await getPartnerProfile(partner.data);
    return (
      <PageContainer layout="page" className="grid max-w-3xl gap-8">
        <PageHeader title={headings.partner_profile}>
          {profile.state === "found" ? <p className="text-body font-medium wrap-anywhere">{profile.profile.displayName}</p> : null}
        </PageHeader>
        <ReportForm lang={lang} type={kind} target={partner.data} category={category} signedIn={user !== null} />
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
      <ReportForm lang={lang} type={kind} target={target} category={category} signedIn={user !== null} />
    </PageContainer>
  );
}

async function getKnownJob(value: string) {
  const id = vacancyIdFrom(value);
  return id ? getPublicJob(id) : null;
}
