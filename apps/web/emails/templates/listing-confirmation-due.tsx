import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url, type Payload } from "../payload.ts";
import type { Template } from "../template.ts";

function plural(count: number): string {
  return count === 1 ? "1 availability listing" : `${count} availability listings`;
}

// The listings named in the payload (the ten confirmed longest ago), each with its occupation and source country.
function listings(payload: Payload) {
  const items = Array.isArray(payload.listings) ? (payload.listings as Payload[]) : [];
  return items.flatMap((item) => {
    const id = field(item, "listing_id");
    const occupation = field(item, "occupation");
    return id && occupation
      ? [{ id, occupation, country: field(item, "country_name"), confirmed: longDate(field(item, "confirmed_at")) }]
      : [];
  });
}

export const listingConfirmationDue: Template = {
  subject: () => "Confirm your availability listings",
  Body: ({ payload, siteUrl }) => {
    const lines = listings(payload);
    const total = Math.max(Number(field(payload, "total")) || 0, lines.length);
    const staleDays = Number(field(payload, "stale_days")) || undefined;
    const org = field(payload, "org_name");
    const slug = field(payload, "org_slug");
    return (
      <Layout preview="Some availability listings need confirming" heading="Confirm your availability listings">
        <Paragraph>
          {total > 0 ? plural(total) : "Some availability listings"}
          {org ? ` of ${org}` : ""} {total === 1 ? "was" : "were"} last confirmed a while ago. Confirm that the numbers are still
          right so that employers keep seeing them.
        </Paragraph>
        {lines.map((line) => (
          <Paragraph key={line.id}>
            {line.occupation}
            {line.country ? ` from ${line.country}` : ""}
            {line.confirmed ? `, last confirmed on ${line.confirmed}` : ""}.
          </Paragraph>
        ))}
        {total > lines.length ? <Paragraph>And {plural(total - lines.length)} more.</Paragraph> : null}
        <Paragraph>
          {staleDays
            ? `A listing not confirmed for ${staleDays} days is hidden from search until it is confirmed again.`
            : "A listing not confirmed for a while is hidden from search until it is confirmed again."}
        </Paragraph>
        {slug ? <Action href={url(siteUrl, `/org/${slug}/workforce-profile#availability-heading`)}>Confirm your listings</Action> : null}
      </Layout>
    );
  },
};
