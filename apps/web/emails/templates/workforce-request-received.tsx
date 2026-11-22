import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-P2 AC11 (step Request workforce): an employer asks the staffing partner for workers and invited it to a draft
// requirement. The payload holds the connection, the conversation, the employer's display name, the occupation, the
// number of workers, the destination and the start date, and the slug of the recipient's own company; never the text.
export const workforceRequestReceived: Template = {
  subject: (payload) => `${field(payload, "org_name") ?? "An employer"} requests workers from you`,
  Body: ({ payload, siteUrl }) => {
    const employer = field(payload, "org_name") ?? "An employer";
    const quantity = field(payload, "quantity");
    const occupation = field(payload, "occupation");
    const country = field(payload, "country_name");
    const start = longDate(field(payload, "start_date"));
    const slug = field(payload, "org_slug");
    const id = field(payload, "conversation_id");
    const need = [quantity && occupation ? `${quantity} × ${occupation}` : occupation, country ? `in ${country}` : null, start ? `from ${start}` : null]
      .filter(Boolean)
      .join(" ");
    return (
      <Layout preview={`${employer} requests workers from you`} heading="You have a new workforce request">
        <Paragraph>
          {employer} requests workers from your company{need ? `: ${need}` : ""}. The employer completes and publishes the
          requirement before you can respond to it; you can already reply in the conversation.
        </Paragraph>
        {slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/messages/${id}`)}>Read the request</Action>
        ) : null}
      </Layout>
    );
  },
};
