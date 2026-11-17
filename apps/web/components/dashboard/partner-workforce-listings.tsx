import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { LinkButton } from "@/components/layout/link-button";
import { ConfirmListing } from "@/components/organization/confirm-listing";
import type { WorkforceListing } from "@/lib/dal/workforce-availability";
import { formatCount } from "@/lib/i18n/format";
import { freshnessLabel, listingFreshness, type AvailabilityRules } from "@/lib/workforce/freshness";

type PartnerWorkforceListingsProps = {
  slug: string;
  canManage: boolean;
  listings: WorkforceListing[];
  // The names of the occupations and source countries of the listings, by code.
  names: { occupations: Record<string, string>; countries: Record<string, string> };
  rules: AvailabilityRules;
  action: { label: string; href: string };
  now: string;
};

// The available workforce of a partner on its dashboard (FR-R3 AC8, FR-R4 AC4, AC5): every listing with the date it was
// last confirmed, the longest unconfirmed first, a warning in words on a listing hidden from search and, for the owner and
// admins, Confirm on each listing that needs it (FR-K3; the same action as the workforce profile).
export function PartnerWorkforceListings({ slug, canManage, listings, names, rules, action, now }: PartnerWorkforceListingsProps) {
  if (listings.length === 0) {
    return canManage ? (
      <EmptyState title="No workforce listed yet" description="Add the workers you can supply, by country and occupation.">
        <LinkButton href={action.href}>{action.label}</LinkButton>
      </EmptyState>
    ) : (
      <EmptyState
        title="No workforce listed yet"
        description="Your owner or an administrator lists the workers your company can supply, by country and occupation."
      />
    );
  }
  const at = new Date(now);
  return (
    <ul className="grid gap-4" aria-label="Available workforce listings">
      {listings.map((listing) => {
        const occupation = names.occupations[listing.occupation] ?? listing.occupation;
        const country = names.countries[listing.country] ?? listing.country;
        const name = `${occupation} from ${country}`;
        const freshness = listingFreshness(listing.confirmedAt, at, rules);
        const { text } = freshnessLabel(freshness, listing.confirmedAt, at);
        return (
          <li key={listing.id} className="grid gap-2 rounded-xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-h3 break-words">
                {occupation}, {country}
              </h3>
              {freshness.state === "hidden" ? (
                <StatusBadge status="warning">Not confirmed for {formatCount(rules.staleDays)} days or more</StatusBadge>
              ) : null}
            </div>
            <p className="text-body">
              {formatCount(listing.available)} available now, {formatCount(listing.monthlyCapacity)} per month
            </p>
            <p className="text-small text-muted-foreground">{text}</p>
            {canManage && freshness.state !== "fresh" ? (
              <div>
                <ConfirmListing slug={slug} listing={listing} name={name} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
