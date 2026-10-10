import { notFound } from "next/navigation";
import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { JobModerationBadge } from "@/components/admin/job-moderation-badge";
import { DetailList } from "@/components/layout/detail-list";
import { ModerationForm } from "@/components/admin/moderation-form";
import { PageHeader } from "@/components/layout/page-header";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { TextLink } from "@/components/forms/text-link";
import { Section } from "@/components/layout/section";
import { getOrganization } from "@/lib/dal/admin";
import { formatShortDate } from "@/lib/i18n/format";
import { isJobStatus, statusLabels } from "@/lib/jobs/presentation";
import { adminPath } from "@/lib/routes";
import type { PlatformRole } from "@/lib/validation/admin";
import { roleLabels } from "@/lib/validation/team";

export async function OrganizationView({ lang, id, roles }: { lang: string; id: string; roles: readonly PlatformRole[] }) {
  const organization = await getOrganization(id);
  if (!organization) notFound();

  return (
    <div className="grid gap-6">
      <PageHeader title={organization.displayName}>
        <TextLink standalone href={adminPath(lang, "organizations")}>
          Back to the organisation search
        </TextLink>
      </PageHeader>
      <Section id="organisation" title="Organisation">
        <DetailList
          items={[
            { label: "Legal name", value: organization.legalName },
            { label: "Address name", value: organization.slug },
            { label: "Organisation id", value: organization.id },
            { label: "Status", value: <AccountStatusBadge status={organization.status} /> },
          ]}
        />
      </Section>
      <Section id="members" title="Members">
        <ResultsTable caption="Members" columns={["Member", "Role", "Joined"]}>
          {organization.members.map((member) => (
            <tr key={member.userId}>
              <td className={`${cell} break-all`}>
                <TextLink href={adminPath(lang, `users/${member.userId}`)}>{member.displayName ?? member.userId}</TextLink>
              </td>
              <td className={cell}>{roleLabels[member.role]}</td>
              <td className={cell}>{member.acceptedAt ? formatShortDate(member.acceptedAt) : "Not accepted yet"}</td>
            </tr>
          ))}
        </ResultsTable>
      </Section>
      <Section id="vacancies" title="Vacancies" description="The latest 100. Applicants are not shown here.">
        {organization.vacancies.length === 0 ? (
          <p className="text-body">This organisation has no vacancies.</p>
        ) : (
          <ResultsTable caption="Vacancies" columns={["Vacancy", "Status", "Visibility"]}>
            {organization.vacancies.map((vacancy) => (
              <tr key={vacancy.id}>
                <td className={`${cell} break-words`}>
                  {roles.includes("trust_safety") ? (
                    <TextLink href={adminPath(lang, `moderation/${vacancy.id}`)}>{vacancy.title}</TextLink>
                  ) : (
                    vacancy.title
                  )}
                </td>
                <td className={cell}>{isJobStatus(vacancy.status) ? statusLabels[vacancy.status] : vacancy.status}</td>
                <td className={cell}>
                  <JobModerationBadge state={vacancy.moderationState} />
                </td>
              </tr>
            ))}
          </ResultsTable>
        )}
      </Section>
      {roles.includes("trust_safety") ? (
        <Section
          id="standing"
          title={organization.status === "suspended" ? "Reinstate this organisation" : "Suspend this organisation"}
          description={
            organization.status === "suspended"
              ? "Its vacancies come back, except any that were hidden on their own. The owner and administrators are emailed."
              : "Its visible vacancies leave the public, its members are signed out and its owner and administrators are emailed the reasons. The subscription is left as it is."
          }
        >
          <ModerationForm target="organization" id={organization.id} standing={organization.status} />
        </Section>
      ) : null}
    </div>
  );
}
