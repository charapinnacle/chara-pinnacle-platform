import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// One kind, two readers (FR-S1 step Inform): the affected company reads the decision, the reasons and the appeal route; a
// signed-in reporter reads only the outcome of the report, never the reasons or who was reported (FR-J3 AC10).
function isReporterNotice(payload: Record<string, unknown>): boolean {
  return field(payload, "reference") !== undefined;
}

export const moderationDecision: Template = {
  subject: (payload) => {
    if (isReporterNotice(payload)) return `Your report ${field(payload, "reference")} was closed`;
    const title = field(payload, "title") ?? "Your partner profile";
    return field(payload, "decision") === "unhide" ? `${title} is shown again` : `${title} was hidden by moderation`;
  },
  Body: ({ payload, siteUrl }) => {
    if (isReporterNotice(payload)) {
      const reference = field(payload, "reference");
      const actioned = field(payload, "outcome") === "actioned";
      return (
        <Layout preview={`Your report ${reference} was closed`} heading="Your report was closed">
          <Paragraph>
            Our moderators closed your report {reference}.{" "}
            {actioned ? "They took action on what you reported." : "They decided that no action was needed."}
          </Paragraph>
          <Action href={url(siteUrl, "/reports")}>See your reports</Action>
        </Layout>
      );
    }
    const title = field(payload, "title") ?? "your partner profile";
    const reasons = field(payload, "reasons");
    const slug = field(payload, "org_slug");
    const unhidden = field(payload, "decision") === "unhide";
    return (
      <Layout
        preview={unhidden ? `${title} is shown again` : `${title} was hidden by moderation`}
        heading={unhidden ? "Your partner profile is shown again" : "Your partner profile was hidden"}
      >
        <Paragraph>
          {unhidden
            ? `Our moderators made the partner profile of ${title} public again. The reasons:`
            : `Our moderators hid the partner profile of ${title}. It is no longer shown in the partner directories or to employers. The reasons:`}
        </Paragraph>
        {reasons ? <Quote>{reasons}</Quote> : null}
        {unhidden ? null : (
          <>
            <Paragraph>
              If you think this was a mistake, you can appeal. The route is described on the Complaints and Dispute Process page.
            </Paragraph>
            <Action href={url(siteUrl, "/legal/complaints-and-dispute-process")}>How to appeal</Action>
          </>
        )}
        {slug ? (
          <Paragraph>
            <a href={url(siteUrl, `/org/${slug}/workforce-profile${unhidden ? "" : "#moderation-heading"}`)}>Open your workforce profile</a>
          </Paragraph>
        ) : null}
      </Layout>
    );
  },
};
