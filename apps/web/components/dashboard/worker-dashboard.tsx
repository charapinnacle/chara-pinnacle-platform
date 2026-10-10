import { Bell, Bookmark, CalendarCheck, IdCard, Search, Send, Settings } from "lucide-react";
import { Panel } from "@/components/dashboard/panel";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentApplications } from "@/components/dashboard/recent-applications";
import { StageTable } from "@/components/dashboard/stage-table";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { DocumentReminders } from "@/components/documents/document-reminders";
import { EmptyState } from "@/components/feedback/empty-state";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { CompletenessCard } from "@/components/passport/completeness-card";
import { openStages } from "@/lib/applications/stage-machine";
import { getMyStageCounts, getRecentApplications } from "@/lib/dal/applications";
import type { DocumentReminder } from "@/lib/dal/documents";
import { countSavedJobs } from "@/lib/dal/saved-jobs";
import { sumOf } from "@/lib/dashboard/stage-counts";
import { savedPath } from "@/lib/jobs/saved";
import type { Completeness } from "@/lib/passport/completeness";
import { applicationsPath, notificationSettingsPath, settingsPath } from "@/lib/routes";

type WorkerDashboardProps = {
  lang: string;
  firstName: string;
  completeness: Completeness;
  reminders: DocumentReminder[];
  today: string;
};

// The first step of a candidate who has not applied yet: the occupation when it is missing (an application needs it),
// otherwise the search.
function FirstApplication({ lang, completeness }: { lang: string; completeness: Completeness }) {
  const occupationMissing = completeness.items.some((item) => item.key === "occupation" && !item.done);
  return occupationMissing ? (
    <EmptyState icon={Send} title="No applications yet" description="Start by adding your occupation to your passport: you need it to apply, and employers see it first.">
      <LinkButton href={`/${lang}/passport#occupation`}>Complete your passport</LinkButton>
    </EmptyState>
  ) : (
    <EmptyState icon={Send} title="No applications yet" description="Your passport is ready to share. Find a vacancy that fits you and apply: each change of its stage shows here.">
      <LinkButton href={`/${lang}/jobs`}>Browse vacancies</LinkButton>
    </EmptyState>
  );
}

type Stages = ReturnType<typeof getMyStageCounts>;

// The three figures, each linked to the list it counts.
function WorkerFigures({ lang, stages }: { lang: string; stages: Stages }) {
  return (
    <div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Panel promise={stages} errorTitle="Your applications could not be counted">
        {(totals) => (
          <SummaryCard label="My applications" detail={`${sumOf(totals, openStages)} in progress`} value={sumOf(totals)} href={applicationsPath(lang)} icon={Send} />
        )}
      </Panel>
      <Panel promise={stages} errorTitle="Your interviews could not be counted">
        {(totals) => (
          <SummaryCard
            label="Interviews"
            detail="Applications in the interview stage now"
            value={totals.interview}
            href={applicationsPath(lang, { stage: "interview" })}
            icon={CalendarCheck}
          />
        )}
      </Panel>
      <div className="sm:col-span-2 xl:col-span-1">
        <Panel promise={countSavedJobs()} errorTitle="Your saved vacancies could not be counted">
          {(count) => <SummaryCard label="Saved vacancies" detail="Kept to read or apply later" value={count} href={savedPath(lang)} icon={Bookmark} />}
        </Panel>
      </div>
    </div>
  );
}

// The latest changes and the stages, or the first step when there is no application yet.
function WorkerActivity({ lang, completeness, stages }: { lang: string; completeness: Completeness; stages: Stages }) {
  const now = new Date();
  return (
    <Panel promise={Promise.all([stages, getRecentApplications()])} errorTitle="Your recent applications could not be loaded">
      {([totals, applications]) =>
        applications.length === 0 ? (
          <FirstApplication lang={lang} completeness={completeness} />
        ) : (
          <div className="animate-stagger grid items-start gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 xl:col-span-8">
              <RecentApplications lang={lang} applications={applications} now={now} />
            </div>
            <div className="lg:col-span-5 xl:col-span-4">
              <StageTable
                id="my-stages-heading"
                title="Applications by stage"
                description="All your applications, counted now"
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

// The candidate's dashboard (UX-03): the figures of their applications, the passport and its next step, the latest
// changes, and the pages they use most. Each read shows its own skeleton or error; nothing here is stored.
export function WorkerDashboard({ lang, firstName, completeness, reminders, today }: WorkerDashboardProps) {
  const stages = getMyStageCounts();

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${firstName}`}
        actions={
          <LinkButton href={`/${lang}/jobs`} size="default" className="gap-2">
            <Search aria-hidden className="size-4" />
            Find jobs
          </LinkButton>
        }
      />
      <WorkerFigures lang={lang} stages={stages} />
      <div className="animate-stagger grid items-start gap-6 lg:grid-cols-12">
        <Section id="passport-strength" title="Your passport" description="What employers see when you apply" className="lg:col-span-7 xl:col-span-8">
          <CompletenessCard lang={lang} completeness={completeness} />
        </Section>
        <div className="grid gap-6 lg:col-span-5 xl:col-span-4">
          <QuickActions
            actions={[
              { href: `/${lang}/passport`, label: "Open your passport", icon: IdCard },
              { href: notificationSettingsPath(lang), label: "Notification settings", icon: Bell },
              { href: settingsPath(lang), label: "Account settings", icon: Settings },
            ]}
          />
          <DocumentReminders lang={lang} reminders={reminders} today={today} />
        </div>
      </div>
      <WorkerActivity lang={lang} completeness={completeness} stages={stages} />
    </div>
  );
}
