"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { BOOST_FAILURE } from "@/lib/boosts/presentation";
import { requestBoostCheckout } from "@/lib/dal/boosts";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { boostPath, mfaPath } from "@/lib/routes";
import { slugSchema } from "@/lib/validation/team";

const inputSchema = z.object({ slug: slugSchema, sku: z.string().regex(/^[a-z0-9_]{1,64}$/) });

const REASONS: Record<string, string> = {
  boosts_off: "Boosts cannot be bought at the moment.",
  unknown_product: "This boost cannot be bought online. Reload the page to see the boosts on sale.",
  product_not_sold: "This boost cannot be bought online. Reload the page to see the boosts on sale.",
  product_not_for_org_type: "This boost is for another type of company.",
  not_listed: "Your company can buy a boost once its profile is listed.",
  organization_suspended: "This organisation is suspended, so it cannot buy a boost.",
};

// The owner or an admin starts the one-time payment of a boost; the database checks the role, the second step, the listing,
// the product and the release switch again, and the boost exists only once the provider reports the payment.
export async function startBoostCheckout(slug: string, sku: string): Promise<{ message: string } | undefined> {
  const parsed = inputSchema.safeParse({ slug, sku });
  if (!parsed.success) return { message: BOOST_FAILURE };
  const back = boostPath(defaultLocale, parsed.data.slug);
  const { organization } = await requireOrgRole(defaultLocale, parsed.data.slug, "admin", { partner: true });

  const session = await requestBoostCheckout(organization.id, parsed.data.sku);
  if ("url" in session) redirect(session.url);
  const { status, reason } = session.refusal;
  if (status === 401 || reason === "aal2_required") redirect(mfaPath(defaultLocale, back));
  return { message: (reason && REASONS[reason]) || BOOST_FAILURE };
}
