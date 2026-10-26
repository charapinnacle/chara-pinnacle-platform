import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";
import { BRAND_NAME } from "../../lib/brand.ts";

export const accountSuspended: Template = {
  subject: (payload) => {
    const org = field(payload, "org_name");
    return org ? `Your organisation ${org} was suspended` : `Your ${BRAND_NAME} account was suspended`;
  },
  Body: ({ payload, siteUrl }) => {
    const org = field(payload, "org_name");
    const reasons = field(payload, "reasons");
    // An organisation suspended while release 2a is on appeals the decision (FR-S1); a user, and every suspension before
    // the release, follows the Complaints and Dispute Process.
    const decision = field(payload, "moderation_action_id");
    return (
      <Layout
        preview={org ? `${org} was suspended` : "Your account was suspended"}
        heading={org ? "Your organisation was suspended" : "Your account was suspended"}
      >
        <Paragraph>
          {org
            ? `Our moderators suspended the organisation ${org}. Its vacancies are no longer shown, its team cannot manage it, and everyone in it was signed out.`
            : "Our moderators suspended your account. You were signed out and you cannot sign in until it is reinstated."}{" "}
          The reasons:
        </Paragraph>
        {reasons ? <Quote>{reasons}</Quote> : null}
        {decision ? (
          <>
            <Paragraph>
              If you think this was a mistake, the owner or an admin can appeal. A moderator who did not take the decision reviews the
              appeal.
            </Paragraph>
            <Action href={url(siteUrl, `/appeals/${decision}`)}>Appeal this decision</Action>
          </>
        ) : (
          <>
            <Paragraph>If you think this was a mistake, you can appeal. The route is described on the Complaints and Dispute Process page.</Paragraph>
            <Action href={url(siteUrl, "/legal/complaints-and-dispute-process")}>How to appeal</Action>
          </>
        )}
      </Layout>
    );
  },
};
