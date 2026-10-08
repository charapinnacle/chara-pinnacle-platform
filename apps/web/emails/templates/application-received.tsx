import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Payload } from "../payload.ts";
import type { Template } from "../template.ts";

function plural(count: number): string {
  return count === 1 ? "1 application" : `${count} applications`;
}

// The summary of a member who chose it: a total and, per vacancy, the title, the organisation and the count.
function summary(payload: Payload) {
  const vacancies = Array.isArray(payload.vacancies) ? (payload.vacancies as Payload[]) : [];
  return vacancies.flatMap((vacancy) => {
    const title = field(vacancy, "job_title");
    const slug = field(vacancy, "org_slug");
    const id = field(vacancy, "job_id");
    return title && slug && id ? [{ title, org: field(vacancy, "org_name"), slug, id, count: Number(field(vacancy, "count")) }] : [];
  });
}

export const applicationReceived: Template = {
  subject: (payload) =>
    payload.vacancies !== undefined
      ? "Your daily summary of new applications"
      : `New application for ${field(payload, "job_title") ?? "your vacancy"}`,
  Body: ({ payload, siteUrl }) => {
    if (payload.vacancies !== undefined) {
      const lines = summary(payload);
      const total = Number(field(payload, "total"));
      const listed = lines.reduce((sum, line) => sum + line.count, 0);
      return (
        <Layout preview="New applications since the last summary" heading="Your daily summary of new applications">
          <Paragraph>
            You received {plural(total)} since the last summary.
          </Paragraph>
          {lines.map((line) => (
            <Paragraph key={line.id}>
              {line.title}
              {line.org ? ` (${line.org})` : ""}: {plural(line.count)}.{" "}
              <a href={url(siteUrl, `/org/${line.slug}/applicants?job=${encodeURIComponent(line.id)}`)}>Review applicants</a>
            </Paragraph>
          ))}
          {total > listed ? <Paragraph>And applications for other vacancies.</Paragraph> : null}
        </Layout>
      );
    }
    const title = field(payload, "job_title") ?? "your vacancy";
    const org = field(payload, "org_name");
    const slug = field(payload, "org_slug");
    const id = field(payload, "application_id");
    return (
      <Layout preview={`A candidate applied for ${title}`} heading="You have a new application">
        <Paragraph>
          A candidate applied for {title}
          {org ? ` at ${org}` : ""}. Open the application to review it.
        </Paragraph>
        {slug && id ? <Action href={url(siteUrl, `/org/${slug}/applicants/${id}`)}>Review the application</Action> : null}
      </Layout>
    );
  },
};
