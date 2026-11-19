import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url, type Payload } from "../payload.ts";
import type { Template } from "../template.ts";

// The vacancies named in the payload (at most ten), by title.
function vacancies(payload: Payload) {
  const items = Array.isArray(payload.vacancies) ? (payload.vacancies as Payload[]) : [];
  return items.flatMap((item) => {
    const id = field(item, "job_id");
    const title = field(item, "job_title");
    return id && title ? [{ id, title }] : [];
  });
}

function plural(count: number): string {
  return count === 1 ? "1 new vacancy" : `${count} new vacancies`;
}

// The daily digest of a followed company (FR-L4 AC6, AC8): the company, its new vacancies by title and one link to its
// company page. At most one a day per company; the follower turns it off in the notification settings.
export const followedCompanyActivity: Template = {
  subject: (payload) => {
    const org = field(payload, "org_name");
    const total = Math.max(Number(field(payload, "total")) || 0, vacancies(payload).length);
    return org ? `${org} published ${total > 0 ? plural(total) : "new vacancies"}` : "New vacancies at a company you follow";
  },
  Body: ({ payload, siteUrl }) => {
    const lines = vacancies(payload);
    const total = Math.max(Number(field(payload, "total")) || 0, lines.length);
    const org = field(payload, "org_name");
    const slug = field(payload, "org_slug");
    return (
      <Layout preview={`${org ?? "A company you follow"} published new vacancies`} heading="New vacancies at a company you follow">
        <Paragraph>
          {org ?? "A company you follow"} published {total > 0 ? plural(total) : "new vacancies"}.
        </Paragraph>
        {lines.map((line) => (
          <Paragraph key={line.id}>{line.title}</Paragraph>
        ))}
        {total > lines.length && lines.length > 0 ? <Paragraph>And {plural(total - lines.length)} more.</Paragraph> : null}
        {slug ? <Action href={url(siteUrl, `/companies/${slug}`)}>See the vacancies</Action> : null}
        <Paragraph>
          You get this email because you follow {org ?? "this company"}, at most once a day. You can unfollow the company on its
          page or turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
