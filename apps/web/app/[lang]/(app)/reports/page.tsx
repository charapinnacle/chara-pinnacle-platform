import type { Metadata } from "next";
import { Flag } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { MyReportsList } from "@/components/reports/my-reports-list";
import { requireUser } from "@/lib/dal/session";
import { listMyReports } from "@/lib/dal/reports";
import { myReportsPath } from "@/lib/routes";
import { reportCursorSchema } from "@/lib/validation/report";

export const metadata: Metadata = { title: "My reports - CHARA", robots: { index: false } };

// The reports the signed-in user made, newest first, each with its status and, once closed, the outcome and the note of
// Trust & Safety. A report is read by its reporter only.
export default async function MyReportsPage({ params, searchParams }: PageProps<"/[lang]/reports">) {
  const [{ lang }, { afterAt, afterId }] = await Promise.all([params, searchParams]);
  await requireUser(lang);
  const cursor = reportCursorSchema.safeParse({ at: afterAt, id: afterId });
  const { reports, next } = await listMyReports(cursor.success ? cursor.data : null);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader title="My reports" description="What you reported, and what Trust & Safety decided." />
      {reports.length === 0 ? (
        <EmptyState icon={Flag} title="You have not made a report" description="Report a vacancy, a company or a page from Trust & Safety.">
          <TextLink href={`/${lang}/trust-safety`}>Go to Trust &amp; Safety</TextLink>
        </EmptyState>
      ) : (
        <MyReportsList reports={reports} />
      )}
      {next ? (
        <TextLink standalone href={myReportsPath(lang, next)}>
          Show older reports
        </TextLink>
      ) : null}
    </div>
  );
}
