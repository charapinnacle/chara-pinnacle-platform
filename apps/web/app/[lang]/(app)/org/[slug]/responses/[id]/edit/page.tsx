import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { ResponseForm } from "@/components/responses/response-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCurrencies } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getResponse, getResponseDocumentsMax, listResponseDocuments } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { isLive } from "@/lib/responses/presentation";
import { billingPath, responsePath, responsesPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Change response", robots: { index: false } };

// The edit of a live response (FR-O2 step Edit, AC8), from the version the page was loaded with: a save after someone
// else's change is refused as stale and asks to reload. A response the employer decided on, a withdrawn one, or one of a
// closed or filled requirement goes back to its read view.
export default async function EditResponsePage({ params }: PageProps<"/[lang]/org/[slug]/responses/[id]/edit">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Change response" subject="responses" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const response = await getResponse(organization.id, parsedId.data);
  if (!response) notFound();
  if (!isLive(response.status) || response.requirementStatus === "closed" || response.requirementStatus === "filled") {
    redirect(responsePath(lang, slug, response.id));
  }
  const [currencies, documents, documentsMax] = await Promise.all([
    getCurrencies(),
    listResponseDocuments({ organizationId: organization.id, requirementId: response.requirementId }),
    getResponseDocumentsMax(),
  ]);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Change your response"
        description={response.title}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Responses", href: responsesPath(lang, slug) },
              { label: response.title, href: responsePath(lang, slug, response.id) },
              { label: "Change" },
            ]}
          />
        }
      />
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        Saving a change writes a new version; the employer sees that your response was updated and can read every version.
      </p>
      <ResponseForm
        lang={lang}
        slug={slug}
        requirementId={response.requirementId}
        edit={{
          responseId: response.id,
          version: response.version,
          kept: { capacity: response.capacity, availableFrom: response.availableFrom },
          values: {
            capacity: String(response.capacity),
            availableFrom: response.availableFrom,
            timelineNote: response.timelineNote ?? "",
            experienceNote: response.experienceNote,
            feeModel: response.feeModel,
            feeAmount: response.feeAmount === null ? "" : String(response.feeAmount),
            feeCurrency: response.feeCurrency ?? "",
            notes: response.notes ?? "",
          },
        }}
        workersNeeded={response.workersNeeded}
        maxCapacity={response.maxCapacity}
        currencies={currencies}
        documents={documents}
        documentsMax={documentsMax}
        organization={{ id: organization.id, type: organization.type, canManage: organization.role !== "member" }}
        billingHref={billingPath(lang, slug)}
      />
    </div>
  );
}
