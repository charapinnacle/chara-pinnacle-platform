import { notFound } from "next/navigation";
import { DetailList } from "@/components/layout/detail-list";
import { JobModerationBadge } from "@/components/admin/job-moderation-badge";
import { ModerateJobDialog } from "@/components/admin/moderate-job-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { TextLink } from "@/components/forms/text-link";
import { Section } from "@/components/layout/section";
import { getModerationJob } from "@/lib/dal/admin-jobs";
import { formatDateTime } from "@/lib/i18n/format";
import { statusLabels } from "@/lib/jobs/presentation";
import { adminPath } from "@/lib/routes";

const actionLabels = { job_hidden: "Hidden", job_unhidden: "Unhidden" } as const;

export async function JobModerationView({ lang, id }: { lang: string; id: string }) {
  const job = await getModerationJob(id);
  if (!job) notFound();

  return (
    <div className="grid gap-6">
      <PageHeader title={job.title}>
        <TextLink standalone href={adminPath(lang, "moderation")}>
          Back to the vacancy search
        </TextLink>
      </PageHeader>
      <Section id="vacancy" title="Vacancy" description="As the employer wrote it. Applicants are not shown here.">
        <DetailList
          items={[
            {
              label: "Organisation",
              value: <TextLink href={adminPath(lang, `organizations/${job.organizationId}`)}>{job.organizationName}</TextLink>,
            },
            { label: "Vacancy id", value: job.id },
            { label: "Status", value: statusLabels[job.status] },
            { label: "Visibility", value: <JobModerationBadge state={job.moderationState} /> },
            { label: "Place", value: `${job.city}, ${job.countryCode}` },
            { label: "Created", value: formatDateTime(job.createdAt) },
            { label: "Description", value: <p className="whitespace-pre-line">{job.description}</p> },
          ]}
        />
      </Section>
      <Section id="history" title="Moderation history" description="The latest 20 decisions, newest first.">
        {job.history.length === 0 ? (
          <p className="text-body">This vacancy was never hidden.</p>
        ) : (
          <ResultsTable caption="Moderation history, newest first" columns={["Time", "Action", "Reasons"]}>
            {job.history.map((entry) => (
              <tr key={`${entry.at}-${entry.action}`}>
                <td className={cell}>{formatDateTime(entry.at)}</td>
                <td className={cell}>{actionLabels[entry.action]}</td>
                <td className={`${cell} break-words`}>{entry.reasons}</td>
              </tr>
            ))}
          </ResultsTable>
        )}
      </Section>
      {job.moderationState === "org_suspended" ? (
        <Section id="decision" title="Hidden with the suspension">
          <p className="text-body">
            The organisation is suspended, so this vacancy is not public. It becomes visible again when the organisation is reinstated.
          </p>
        </Section>
      ) : (
        <Section
          id="decision"
          title={job.moderationState === "hidden" ? "Unhide this vacancy" : "Hide this vacancy"}
          description={
            job.moderationState === "hidden"
              ? "It becomes public again if it is open. Its organisation is not emailed."
              : "It leaves the public at once and takes no new applications. The owner and administrators of the organisation are emailed the reasons and how to appeal."
          }
        >
          <ModerateJobDialog
            id={job.id}
            title={job.title}
            organizationName={job.organizationName}
            action={job.moderationState === "hidden" ? "unhide" : "hide"}
          />
        </Section>
      )}
    </div>
  );
}
