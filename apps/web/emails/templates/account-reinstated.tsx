import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const accountReinstated: Template = {
  subject: (payload) => {
    const org = field(payload, "org_name");
    return org ? `Your organisation ${org} was reinstated` : "Your CHARA account was reinstated";
  },
  Body: ({ payload, siteUrl }) => {
    const org = field(payload, "org_name");
    const reasons = field(payload, "reasons");
    return (
      <Layout
        preview={org ? `${org} was reinstated` : "Your account was reinstated"}
        heading={org ? "Your organisation was reinstated" : "Your account was reinstated"}
      >
        <Paragraph>
          {org
            ? `The suspension of the organisation ${org} is over. Sign in again to manage it. Its vacancies are shown again, except any that moderators hid on their own.`
            : "The suspension of your account is over. Sign in again to carry on."}{" "}
          The reasons:
        </Paragraph>
        {reasons ? <Quote>{reasons}</Quote> : null}
        <Action href={url(siteUrl, "/login")}>Sign in</Action>
      </Layout>
    );
  },
};
