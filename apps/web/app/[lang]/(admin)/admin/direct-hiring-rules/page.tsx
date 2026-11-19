import type { Metadata } from "next";
import { Suspense } from "react";
import { DirectHiringRuleHistory } from "@/components/admin/direct-hiring-rule-history";
import { DirectHiringRuleList } from "@/components/admin/direct-hiring-rule-list";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Direct-hiring rules", robots: { index: false } };

// The direct-hiring rules by country (FR-Q5 AC10, NFR-O5). Every change needs a legal opinion reference and a reason and
// is recorded with the values before and after.
export default async function DirectHiringRulesPage({ params }: PageProps<"/[lang]/admin/direct-hiring-rules">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);

  return (
    <div className="grid gap-page">
      <PageHeader title="Direct-hiring rules">
        <p className="text-body text-muted-foreground">
          Per source country, and optionally per destination, whether employers may hire workers directly, need a licensed partner
          or may not hire directly. The source is the country where the worker lives now. A country without a rule allows direct
          hiring with the general notice of the platform settings. Set rules only after legal review; partner channels stay
          available whatever the rule.
        </p>
      </PageHeader>
      <Suspense fallback={<LoadingSkeleton rows={4} />}>
        <DirectHiringRuleList />
      </Suspense>
      <Suspense fallback={<LoadingSkeleton rows={4} />}>
        <DirectHiringRuleHistory />
      </Suspense>
    </div>
  );
}
