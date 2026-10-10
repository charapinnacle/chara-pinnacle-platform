import { notFound } from "next/navigation";
import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { DetailList } from "@/components/layout/detail-list";
import { ModerationForm } from "@/components/admin/moderation-form";
import { PageHeader } from "@/components/layout/page-header";
import { TextLink } from "@/components/forms/text-link";
import { Section } from "@/components/layout/section";
import { getUser } from "@/lib/dal/admin";
import { formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import type { PlatformRole } from "@/lib/validation/admin";
import { roleLabels } from "@/lib/validation/team";

const kinds = { company: "Employer", worker: "Candidate" } as const;

export async function UserView({ lang, id, roles }: { lang: string; id: string; roles: readonly PlatformRole[] }) {
  const user = await getUser(id);
  if (!user) notFound();

  return (
    <div className="grid gap-6">
      <PageHeader title={user.displayName ?? user.email}>
        <TextLink standalone href={adminPath(lang, "users")}>
          Back to the user search
        </TextLink>
      </PageHeader>
      <Section id="account" title="Account">
        <DetailList
          items={[
            { label: "Email", value: user.email },
            { label: "User id", value: user.id },
            { label: "Account kind", value: user.accountKind ? kinds[user.accountKind] : "Not chosen yet" },
            { label: "Status", value: <AccountStatusBadge status={user.status} /> },
            { label: "Created", value: formatDateTime(user.createdAt) },
            { label: "Applications submitted", value: user.applicationsSubmitted },
            { label: "Vacancies created", value: user.vacanciesCreated },
          ]}
        />
      </Section>
      <Section id="organisations" title="Organisations">
        {user.memberships.length === 0 ? (
          <p className="text-body">This user belongs to no organisation.</p>
        ) : (
          <ul className="grid gap-2">
            {user.memberships.map((membership) => (
              <li key={membership.organizationId}>
                <TextLink href={adminPath(lang, `organizations/${membership.organizationId}`)}>{membership.name}</TextLink>
                <span className="text-muted-foreground"> · {roleLabels[membership.role]}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {roles.includes("trust_safety") && user.status !== "deletion_pending" ? (
        <Section
          id="standing"
          title={user.status === "suspended" ? "Reinstate this account" : "Suspend this account"}
          description={
            user.status === "suspended"
              ? "The person can sign in again with a new session."
              : "The person is signed out, cannot sign in and is emailed the reasons."
          }
        >
          <ModerationForm target="user" id={user.id} standing={user.status} />
        </Section>
      ) : null}
      {roles.includes("admin") ? (
        <TextLink standalone href={adminPath(lang, `mfa-reset?user=${user.id}`)}>
          Reset two-step verification of this user
        </TextLink>
      ) : null}
    </div>
  );
}
