import { Suspense } from "react";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { isReleased } from "@/lib/dal/release";
import { defaultLocale } from "@/lib/i18n/locale";
import { appealsPath } from "@/lib/routes";

// While release 2a is on, the suspension can be appealed from its decision page (FR-S1); before it the page stays as in
// Phase 1. Read in its own boundary, so the notice never waits for it.
async function AppealLink() {
  if (!(await isReleased("release_partner_directories"))) return null;
  return (
    <p>
      <TextLink href={appealsPath(defaultLocale)}>See the decision and appeal</TextLink>
    </p>
  );
}

export function SuspendedOrganization({ title = "Applicants", subject = "applicants" }: { title?: string; subject?: string }) {
  return (
    <div className="grid w-full max-w-3xl gap-4">
      <PageHeader title={title} />
      <Notice tone="error" role="alert">
        This organization is suspended, so its {subject} are not available.
      </Notice>
      <Suspense fallback={null}>
        <AppealLink />
      </Suspense>
    </div>
  );
}
