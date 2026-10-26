import { AdminNav } from "@/components/admin/admin-nav";
import { adminPath } from "@/lib/routes";

// The two pages of the plan editor, as tabs under the page title (FR-R2 AC11).
export function PlanEditorTabs({ lang }: { lang: string }) {
  return (
    <AdminNav
      label="Plans and limits"
      entries={[
        { label: "Plans", href: adminPath(lang, "plans"), exact: true },
        { label: "Overrides", href: adminPath(lang, "plans/overrides") },
      ]}
    />
  );
}
