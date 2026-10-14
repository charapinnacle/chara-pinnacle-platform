import { AvailabilityCard } from "@/components/dashboard/availability-card";
import { Panel } from "@/components/dashboard/panel";
import { RecentApplications } from "@/components/dashboard/recent-applications";
import { StageTable } from "@/components/dashboard/stage-table";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { DocumentReminders } from "@/components/documents/document-reminders";
import { EmptyState } from "@/components/feedback/empty-state";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { CompletenessCard } from "@/components/passport/completeness-card";
import { getMyStageCounts, getRecentApplications } from "@/lib/dal/applications";
import type { DocumentReminder } from "@/lib/dal/documents";
import type { Passport } from "@/lib/dal/passport";
import { countSavedJobs } from "@/lib/dal/saved-jobs";
import { sumOf } from "@/lib/dashboard/stage-counts";
import { savedPath } from "@/lib/jobs/saved";
import type { Completeness } from "@/lib/passport/completeness";
import { applicationPath, applicationsPath } from "@/lib/routes";

type WorkerDashboardProps = {
  lang: string;
  completeness: Completeness;
  availability: Passport["availability"];
  availableFrom: Passport["availableFrom"];
  reminders: DocumentReminder[];
  today: string;
};

// The first step of a candidate who has not applied yet: the occupation when it is missing (an application needs it),
// otherwise the search.
function FirstApplication({ lang, completeness }: { lang: string; completeness: Completeness }) {
  const occupationMissing = completeness.items.some((item) => item.key === "occupation" && !item.done);
  return occupationMissing ? (
    <EmptyState title="No applications yet" description="Start by adding your occupation to your passport: you need it to apply, and employers see it first.">
      <LinkButton href={`/${lang}/passport#occupation`}>Complete your passport</LinkButton>
    </EmptyState>
  ) : (
    <EmptyState title="No applications yet" description="Your passport is ready to share. Find a vacancy that fits you and apply: each change of its stage shows here.">
      <LinkButton href={`/${lang}/jobs`}>Browse vacancies</LinkButton>
    </EmptyState>
  );
}

type Stages = ReturnType<typeof getMyStageCounts>;

// The three latest changes and the stages, each counted once, or the first step when there is no application yet.
function WorkerApplications({ lang, completeness, stages }: { lang: string; completeness: Completeness; stages: Stages }) {
  const now = new Date();
  return (
    <Panel promise={Promise.all([stages, getRecentApplications()])} errorTitle="Your applications could not be loaded">
      {([totals, applications]) =>
        applications.length === 0 ? (
          <FirstApplication lang={lang} completeness={completeness} />
        ) : (
          <div className="animate-stagger grid items-start gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 xl:col-span-8">
              <RecentApplications lang={lang} applications={applications} now={now} hrefFor={(id) => applicationPath(lang, id)} />
            </div>
            <div className="lg:col-span-5 xl:col-span-4">
              <StageTable
                id="my-stages-heading"
                title="Applications by stage"
                countLabel="Applications"
                totals={totals}
                total={sumOf(totals)}
                hrefFor={(stage) => applicationsPath(lang, { stage })}
              />
            </div>
          </div>
        )
      }
    </Panel>
  );
}

// The candidate's dashboard (UX-03): the passport and its next step, when they can start, the saved jobs and the latest
// applications with their stages. Each read shows its own skeleton or error; nothing here is stored.
export function WorkerDashboard({ lang, completeness, availability, availableFrom, reminders, today }: WorkerDashboardProps) {
  const stages = getMyStageCounts();

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Dashboard"
        actions={
          <div className="flex flex-wrap gap-3">
            <LinkButton href={`/${lang}/jobs`} size="default">
              Search jobs
            </LinkButton>
            <LinkButton href={`/${lang}/passport`} variant="secondary" size="default">
              Update passport
            </LinkButton>
            <LinkButton href={`/${lang}/passport#skills`} variant="secondary" size="default">
              Add skills
            </LinkButton>
          </div>
        }
      />
      <div className="animate-stagger grid items-start gap-6 lg:grid-cols-12">
        <Section id="passport-strength" title="Profile completion" className="lg:col-span-7 xl:col-span-8">
          <CompletenessCard lang={lang} completeness={completeness} />
        </Section>
        <div className="grid gap-6 lg:col-span-5 xl:col-span-4">
          <AvailabilityCard lang={lang} availability={availability} availableFrom={availableFrom} />
          <Panel promise={countSavedJobs()} errorTitle="Your saved jobs could not be counted">
            {(count) => <SummaryCard label="Saved jobs" value={count} href={savedPath(lang)} />}
          </Panel>
          <DocumentReminders lang={lang} reminders={reminders} today={today} />
        </div>
      </div>
      <WorkerApplications lang={lang} completeness={completeness} stages={stages} />
    </div>
  );
}
