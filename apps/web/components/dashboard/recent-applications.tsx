import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Card } from "@/components/layout/card";
import { applicationStatusLabels, applicationStatusTones } from "@/lib/applications/presentation";
import type { MyApplication } from "@/lib/dal/applications";
import { formatRelative, formatShortDate } from "@/lib/i18n/format";
import { applicationPath } from "@/lib/routes";

type RecentApplicationsProps = { lang: string; applications: readonly MyApplication[]; now: Date };

// The latest changes first, each row leading to the journey tracker of that application (FR-D3).
export function RecentApplications({ lang, applications, now }: RecentApplicationsProps) {
  return (
    <Card as="section" aria-labelledby="recent-heading" padding="lg" elevated className="content-start gap-2">
      <div className="grid gap-0.5 pb-2">
        <h2 id="recent-heading" className="text-h2">
          Recent applications
        </h2>
        <p className="text-small text-muted-foreground">The three with the latest change</p>
      </div>
      <ul className="animate-stagger -mx-2 grid">
        {applications.map((application) => (
          <li key={application.id} className="border-t first:border-t-0">
            <Link
              href={applicationPath(lang, application.id)}
              className="group flex min-h-16 items-center gap-4 rounded-lg px-2 py-3 transition-colors duration-150 hover:bg-secondary"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{application.jobTitle}</span>
                <span className="truncate text-small text-muted-foreground">{application.employerName}</span>
              </span>
              <span className="grid justify-items-end gap-1">
                <StatusBadge status={applicationStatusTones[application.status]}>{applicationStatusLabels[application.status]}</StatusBadge>
                <time dateTime={application.lastEventAt} title={formatShortDate(application.lastEventAt)} className="text-caption text-muted-foreground">
                  Updated {formatRelative(application.lastEventAt, now)}
                </time>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
