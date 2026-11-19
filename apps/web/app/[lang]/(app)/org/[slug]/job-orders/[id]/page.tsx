import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { JobOrderRefusalNotice } from "@/components/job-orders/job-order-refusal";
import { JobOrderView } from "@/components/job-orders/job-order-view";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { getJobOrder } from "@/lib/dal/job-orders";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { employerLabel } from "@/lib/job-orders/presentation";
import { companyPagePath, jobOrdersPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

// The title of the tab and every tag of the page say only "Job order": no title, employer or place leaves the page in
// its metadata (NFR-S11).
export const metadata: Metadata = { title: "Job order", robots: { index: false } };

// One job order for a member of a recruitment or staffing company (FR-N1 AC2, AC3, AC5, AC9), while release 2b is on. A
// job order that is no longer open says so and shows none of its fields; responding arrives with V46.
export default async function JobOrderPage({ params }: PageProps<"/[lang]/org/[slug]/job-orders/[id]">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Job order" subject="job orders" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const [result, countries, industries] = await Promise.all([getJobOrder(organization.id, parsedId.data), getCountries(), getIndustries()]);
  if (result.state === "not_found") notFound();
  const crumbs = (label: string) => (
    <Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Job orders", href: jobOrdersPath(lang, slug) }, { label }]} />
  );

  if (result.state !== "found") {
    return (
      <div className="grid w-full max-w-3xl gap-section">
        <PageHeader title="Job order" breadcrumb={crumbs("Job order")} />
        {result.state === "closed" ? (
          <Notice tone="info" role="status">
            <p className="font-semibold">This job order is no longer open</p>
            <p>The employer paused, closed or filled it.</p>
          </Notice>
        ) : result.state === "rate_limited" ? (
          <Notice tone="warning" role="alert">
            <p className="font-semibold">Too many requests. Please wait a minute and try again.</p>
          </Notice>
        ) : (
          <JobOrderRefusalNotice lang={lang} slug={slug} reason={result.reason} />
        )}
        <p>
          <TextLink standalone href={jobOrdersPath(lang, slug)}>
            See the open job orders
          </TextLink>
        </p>
      </div>
    );
  }

  const { order } = result;
  const names = {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    industries: new Map(industries.map(({ code, name }) => [code, name])),
  };
  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader title={order.title} breadcrumb={crumbs(order.title)}>
        {order.eligible ? (
          <p className="text-body text-muted-foreground">
            {order.employerCompanySlug && order.employerName ? (
              <TextLink href={companyPagePath(lang, order.employerCompanySlug)}>{order.employerName}</TextLink>
            ) : (
              employerLabel(order.employerName)
            )}
          </p>
        ) : order.employerName ? (
          <p className="text-body text-muted-foreground">{order.employerName}</p>
        ) : null}
      </PageHeader>
      <JobOrderView order={order} names={names} context={{ lang, slug, canManage: organization.role !== "member" }} />
    </div>
  );
}
