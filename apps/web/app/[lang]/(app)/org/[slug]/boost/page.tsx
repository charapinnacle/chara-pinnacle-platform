import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoostButton } from "@/components/boosts/boost-button";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardFooter, CardHeader } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { organizationCrumb } from "@/lib/app/navigation";
import { daysText } from "@/lib/billing/presentation";
import { boostPriceLine } from "@/lib/boosts/presentation";
import { getBoostStatus, listBoostProducts } from "@/lib/dal/boosts";
import { getPartnerReview } from "@/lib/dal/partner-review";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { RANKING_PATH } from "@/lib/public/navigation";

export const metadata: Metadata = { title: "Boost profile", robots: { index: false } };

// A recruitment or staffing company buys paid visibility for its profile in its directory (ARCHITECTURE.md section 10.1):
// the products of its own type, each a one-time payment, and the boost that runs now with its end. The owner and the
// admins buy at aal2 once the profile is listed; a member reads the state. A boost bought while one runs starts at its
// end. The page exists while release 2a and the boosts are on.
export default async function BoostPage({ params }: PageProps<"/[lang]/org/[slug]/boost">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: true });
  const [directories, boosts] = await Promise.all([isReleased("release_partner_directories"), isReleased("release_boosts")]);
  if (!directories || !boosts) notFound();
  const [products, status, review] = await Promise.all([
    listBoostProducts(organization.type),
    getBoostStatus(organization.id),
    getPartnerReview(organization.id),
  ]);
  const listed = review !== null && review.listedAt !== null && review.status !== "declined";
  const canBuy = organization.role !== "member" && listed && !organization.suspended;

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Boost profile"
        description={organization.displayName}
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Boost profile" }]} />}
      />

      <section aria-labelledby="boost-status-heading" className="grid gap-3">
        <h2 id="boost-status-heading" className="text-h2">
          Current boost
        </h2>
        {status ? (
          <p className="text-body">
            {status.running ? "Your profile is boosted until " : "Your boost is paid and runs until "}
            <time dateTime={status.endsAt}>{formatDate(status.endsAt)}</time>.
          </p>
        ) : (
          <p className="text-body text-muted-foreground">Your profile is not boosted.</p>
        )}
        <p className="text-small text-muted-foreground">
          A boosted profile is shown, labelled Boosted, in a separate area above the results of your directory whenever it
          matches every filter of the search, at most three companies at a time. Paying never changes the order of the
          results.{" "}
          <TextLink href={`/${lang}/${RANKING_PATH}`}>How results are ranked</TextLink>
        </p>
      </section>

      <section aria-labelledby="boost-products-heading" className="grid gap-3">
        <h2 id="boost-products-heading" className="text-h2">
          Boosts
        </h2>
        {!listed ? (
          <Notice tone="info" role="status">
            Your company can buy a boost once its profile is listed.
          </Notice>
        ) : organization.role === "member" ? (
          <Notice tone="info" role="status">
            Only the owner and the admins of your company can buy a boost.
          </Notice>
        ) : status ? (
          <p className="text-body text-muted-foreground">A boost you buy now starts when the current one ends.</p>
        ) : null}
        <ul className="grid gap-3">
          {products.map((product) => (
            <Card as="li" key={product.sku} className="gap-1">
              <CardHeader>
                <h3 className="font-medium">{daysText(product.days)}</h3>
                <p className="text-small text-muted-foreground">{boostPriceLine(product)}</p>
              </CardHeader>
              {canBuy ? (
                <CardFooter>
                  <BoostButton slug={slug} sku={product.sku} days={product.days} />
                </CardFooter>
              ) : null}
            </Card>
          ))}
        </ul>
        <p className="text-small text-muted-foreground">
          VAT is added at checkout. A boost is a one-time payment: it does not renew and does not change your plan.
        </p>
      </section>
    </div>
  );
}
