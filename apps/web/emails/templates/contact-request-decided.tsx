import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-Q3 steps Decide and Reveal (AC8): the worker answered a contact request of the recipient's organisation. The payload
// holds the request id, the answer (accepted or declined) and the slug of the recipient's organisation; never the worker's
// name or any field of the passport (NFR-S9): an accepted request names the worker on the organisation's page only.
export const contactRequestDecided: Template = {
  subject: (payload) => {
    const decision = field(payload, "decision");
    if (decision === "accepted") return "A worker accepted your contact request";
    if (decision === "declined") return "A worker declined your contact request";
    return "A worker answered your contact request";
  },
  Body: ({ payload, siteUrl }) => {
    const decision = field(payload, "decision");
    const slug = field(payload, "org_slug");
    const link = slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? url(siteUrl, `/org/${slug}/contact-requests`) : null;
    return (
      <Layout preview="A worker answered your contact request" heading="An answer to your contact request">
        <Paragraph>
          {decision === "accepted"
            ? "A worker accepted your contact request. Their name and a conversation are waiting on the site."
            : decision === "declined"
              ? "A worker declined your contact request. Your organisation cannot contact this worker again for 90 days."
              : "A worker answered your contact request."}
        </Paragraph>
        {link ? <Action href={link}>See your contact requests</Action> : null}
      </Layout>
    );
  },
};
