import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url, type Payload } from "../payload.ts";
import type { Template } from "../template.ts";

const UUID = /^[0-9a-f-]{36}$/;

// The vacancies named in the payload (at most ten), by title.
function vacancies(payload: Payload) {
  const items = Array.isArray(payload.vacancies) ? (payload.vacancies as Payload[]) : [];
  return items.flatMap((item) => {
    const id = field(item, "job_id");
    const title = field(item, "job_title");
    return id && title ? [{ id, title }] : [];
  });
}

// The named job orders of the payload (at most ten), by title; the id comes only for a partner follower (V54).
function jobOrders(payload: Payload) {
  const items = Array.isArray(payload.job_orders) ? (payload.job_orders as Payload[]) : [];
  return items.flatMap((item, index) => {
    const title = field(item, "title");
    const id = field(item, "requirement_id");
    return title ? [{ key: id ?? String(index), title, id: id && UUID.test(id) ? id : null }] : [];
  });
}

function count(total: number, one: string, other: string): string {
  return `${total} ${total === 1 ? one : other}`;
}

function totals(payload: Payload) {
  return {
    vacancyTotal: Math.max(Number(field(payload, "total")) || 0, vacancies(payload).length),
    jobOrderTotal: Math.max(Number(field(payload, "job_order_total")) || 0, jobOrders(payload).length),
  };
}

// "3 new vacancies and 1 new job order", never fewer than the payload lists.
function published(payload: Payload): string {
  const { vacancyTotal, jobOrderTotal } = totals(payload);
  const parts = [
    vacancyTotal > 0 ? count(vacancyTotal, "new vacancy", "new vacancies") : null,
    jobOrderTotal > 0 ? count(jobOrderTotal, "new job order", "new job orders") : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" and ") : "new vacancies";
}

// The daily digest of a followed company (FR-L4 AC6 to AC8): the company, its new vacancies and named job orders by title
// and one link to its company page. A partner follower's job orders link to its own company's job order pages; a
// candidate's carry no link (decision 3.1). At most one a day per company; the follower turns it off in the settings.
export const followedCompanyActivity: Template = {
  subject: (payload) => {
    const org = field(payload, "org_name");
    return org ? `${org} published ${published(payload)}` : "New vacancies at a company you follow";
  },
  Body: ({ payload, siteUrl }) => {
    const lines = vacancies(payload);
    const orders = jobOrders(payload);
    const { vacancyTotal, jobOrderTotal } = totals(payload);
    const org = field(payload, "org_name");
    const slug = field(payload, "org_slug");
    const partnerSlug = field(payload, "partner_slug");
    return (
      <Layout
        preview={`${org ?? "A company you follow"} published ${published(payload)}`}
        heading={orders.length > 0 ? "New at a company you follow" : "New vacancies at a company you follow"}
      >
        <Paragraph>
          {org ?? "A company you follow"} published {published(payload)}.
        </Paragraph>
        {lines.map((line) => (
          <Paragraph key={line.id}>{line.title}</Paragraph>
        ))}
        {vacancyTotal > lines.length && lines.length > 0 ? (
          <Paragraph>And {count(vacancyTotal - lines.length, "new vacancy", "new vacancies")} more.</Paragraph>
        ) : null}
        {orders.length > 0 ? <Paragraph>Job orders for recruitment and staffing companies:</Paragraph> : null}
        {orders.map((order) => (
          <Paragraph key={order.key}>
            {partnerSlug && order.id ? (
              <Link href={url(siteUrl, `/org/${partnerSlug}/job-orders/${order.id}`)}>{order.title}</Link>
            ) : (
              order.title
            )}
          </Paragraph>
        ))}
        {jobOrderTotal > orders.length && orders.length > 0 ? (
          <Paragraph>And {count(jobOrderTotal - orders.length, "job order", "job orders")} more.</Paragraph>
        ) : null}
        {slug ? (
          <Action href={url(siteUrl, `/companies/${slug}`)}>{lines.length > 0 ? "See the vacancies" : "See the company"}</Action>
        ) : null}
        <Paragraph>
          You get this email because you follow {org ?? "this company"}, at most once a day. You can unfollow the company on its
          page or turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
