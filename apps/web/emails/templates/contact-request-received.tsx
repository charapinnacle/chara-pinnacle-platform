import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-Q3 step Notify (AC1): a company that found the worker's card in Find Workers asks to contact the worker. The payload
// holds the request id, the company's display name, type and based-in country, and the title of the vacancy it offers;
// never the message, which is read on the site, nor the member who sent it.
export const contactRequestReceived: Template = {
  subject: (payload) => `${field(payload, "org_name") ?? "A company"} would like to contact you`,
  Body: ({ payload, siteUrl }) => {
    const organization = field(payload, "org_name") ?? "A company";
    const country = field(payload, "country_name");
    const job = field(payload, "job_title");
    return (
      <Layout preview={`${organization} would like to contact you`} heading="A company would like to contact you">
        <Paragraph>
          {organization}
          {country ? ` (${country})` : ""} found your card in Find Workers and sent you a contact request
          {job ? ` with an invitation to apply to "${job}"` : ""}.
        </Paragraph>
        <Paragraph>
          The company does not know your name or contact details. If you accept, it sees your first and last name and you can
          talk in a conversation on the site. If you decline, it cannot contact you again for 90 days.
        </Paragraph>
        <Action href={url(siteUrl, "/contact-requests")}>Read the request</Action>
      </Layout>
    );
  },
};
