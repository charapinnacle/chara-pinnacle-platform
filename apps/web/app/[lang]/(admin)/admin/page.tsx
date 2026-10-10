import { EyeOff, FileText, ShieldAlert, Building2, UserCog, Send } from "lucide-react";
import type { Metadata } from "next";
import { LegalOverview } from "@/components/admin/legal-overview";
import { Panel } from "@/components/dashboard/panel";
import { StageTable } from "@/components/dashboard/stage-table";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { applicationCounts, listLegalDocuments } from "@/lib/dal/admin";
import { moderationCounts, staffCount } from "@/lib/dal/admin-overview";
import { requirePlatformRole } from "@/lib/dal/session";
import { stageTotals, sumOf } from "@/lib/dashboard/stage-counts";
import { formatCount } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import { lastThirtyDays, platformRoleLabels } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "Administration — CHARA", robots: { index: false } };

const statRow = "animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

// The administrator's figures: who holds a staff role, what was applied for in the last 30 days, which legal documents
// are drafts. Counts only, as everything the console reads (FR-F1 AC3).
function AdministratorOverview({ lang }: { lang: string }) {
  const range = lastThirtyDays();
  const statisticsHref = `${adminPath(lang, "statistics")}?from=${range.from}&to=${range.to}`;
  const counts = applicationCounts(range.from, range.to).then((rows) => stageTotals(rows.map(({ status, count }) => ({ status, total: count }))));
  const legal = listLegalDocuments();
  return (
    <section aria-labelledby="administrator-heading" className="grid gap-4">
      <h2 id="administrator-heading" className="text-h2">
        Platform overview
      </h2>
      <div className={statRow}>
        <Panel promise={staffCount()} errorTitle="The staff could not be counted">
          {(count) => <SummaryCard label="Staff members" detail="With an active staff role now" value={count} href={adminPath(lang, "staff")} icon={UserCog} />}
        </Panel>
        <Panel promise={counts} errorTitle="The applications could not be counted">
          {(totals) => (
            <SummaryCard label="Applications" hint="in the last 30 days" detail="Created in that time, any stage, UTC days" value={sumOf(totals)} href={statisticsHref} icon={Send} />
          )}
        </Panel>
        <div className="sm:col-span-2 xl:col-span-1">
          <Panel promise={legal} errorTitle="The legal documents could not be loaded">
            {(documents) => (
              <SummaryCard
                label="Legal documents in draft"
                detail={`Out of ${formatCount(documents.length)} in all`}
                value={documents.filter((document) => document.isDraft).length}
                href={adminPath(lang, "legal")}
                icon={FileText}
              />
            )}
          </Panel>
        </div>
      </div>
      <div className="animate-stagger grid items-start gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel promise={counts} errorTitle="The applications by stage could not be counted">
            {(totals) => (
              <StageTable
                id="admin-stages-heading"
                title="Applications by stage"
                description={`Created from ${range.from} to ${range.to} (UTC, the last 30 days)`}
                countLabel="Applications"
                totals={totals}
                total={sumOf(totals)}
              />
            )}
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel promise={legal} errorTitle="The legal documents could not be loaded">
            {(documents) => <LegalOverview documents={documents} href={adminPath(lang, "legal")} />}
          </Panel>
        </div>
      </div>
    </section>
  );
}

// What the Trust & Safety Administrator acts on: what is suspended or hidden now.
function TrustSafetyOverview({ lang }: { lang: string }) {
  const counts = moderationCounts();
  return (
    <section aria-labelledby="trust-safety-heading" className="grid gap-4">
      <h2 id="trust-safety-heading" className="text-h2">
        Trust and safety
      </h2>
      <div className={statRow}>
        <Panel promise={counts} errorTitle="The suspended accounts could not be counted">
          {({ suspendedUsers }) => (
            <SummaryCard label="Suspended accounts" detail="Suspended now" value={suspendedUsers} href={adminPath(lang, "suspensions")} icon={ShieldAlert} />
          )}
        </Panel>
        <Panel promise={counts} errorTitle="The suspended organisations could not be counted">
          {({ suspendedOrganizations }) => (
            <SummaryCard label="Suspended organisations" detail="Suspended now" value={suspendedOrganizations} href={adminPath(lang, "suspensions")} icon={Building2} />
          )}
        </Panel>
        <div className="sm:col-span-2 xl:col-span-1">
          <Panel promise={counts} errorTitle="The hidden vacancies could not be counted">
            {({ hiddenVacancies }) => (
              <SummaryCard label="Hidden vacancies" detail="Hidden by moderation now" value={hiddenVacancies} href={adminPath(lang, "moderation")} icon={EyeOff} />
            )}
          </Panel>
        </div>
      </div>
    </section>
  );
}

export default async function AdminPage({ params }: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  const { roles } = await requirePlatformRole(lang);
  const administrator = roles.includes("admin");
  const trustSafety = roles.includes("trust_safety");

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Administration"
        description={administrator || trustSafety ? "Every change you make is written to the audit log with your reason." : undefined}
      >
        <p className="text-small text-muted-foreground">{roles.map((role) => platformRoleLabels[role]).join(", ")}</p>
      </PageHeader>
      {administrator ? <AdministratorOverview lang={lang} /> : null}
      {trustSafety ? <TrustSafetyOverview lang={lang} /> : null}
      {administrator || trustSafety ? null : (
        <EmptyState icon={ShieldAlert} title="Nothing to do here yet" description="No functions are available for your role in this release." />
      )}
    </div>
  );
}
