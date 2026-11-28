import { daysText, formatPrice } from "@/lib/billing/presentation";

// The words of paid placement (ARCHITECTURE.md section 10.5; DSA article 26): the rail of a directory and the ranking
// page say the same thing, so a unit test holds both to these strings.
export const BOOSTED_LABEL = "Boosted";

export const railNote =
  "Paid placement. Boosted companies that match your search appear here, apart from the results; paying never changes the order of the results.";

export const rankingBoostCopy =
  'A recruitment or staffing company can pay for a boost of its profile. Up to three boosted companies that match every filter of your search are shown in a separate area above the results, each labelled "Boosted"; when more match, they take turns every hour. A boost never changes the order of the results or whether a company appears in them.';

export const BOOST_FAILURE = "We could not start the payment. Nothing was charged. Try again.";

export type BoostProduct = { sku: string; days: number; priceMinor: number; currency: string };

export function boostPriceLine(product: Pick<BoostProduct, "priceMinor" | "currency" | "days">): string {
  return `${formatPrice(product.priceMinor, product.currency)} for ${daysText(product.days)}, excl. VAT`;
}
