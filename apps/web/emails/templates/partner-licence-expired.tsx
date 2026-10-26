import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const partnerLicenceExpired: Template = {
  subject: (payload) => {
    const country = field(payload, "country_name");
    return `Your licence${country ? ` for ${country}` : ""} has expired`;
  },
  Body: ({ payload, siteUrl }) => {
    const country = field(payload, "country_name");
    const date = longDate(field(payload, "valid_until"));
    const org = field(payload, "org_name");
    const slug = field(payload, "org_slug");
    return (
      <Layout preview="A licence has expired" heading="A licence has expired">
        <Paragraph>
          The licence{org ? ` ${org} recorded` : " you recorded"}
          {country ? ` for ${country}` : ""} {date ? `was valid until ${date}` : "has passed its valid-until date"} and is now marked
          expired.
        </Paragraph>
        <Paragraph>If it was renewed, update the entry with the new date on your workforce profile.</Paragraph>
        {slug ? <Action href={url(siteUrl, `/org/${slug}/workforce-profile#licences-heading`)}>Update your licences</Action> : null}
      </Layout>
    );
  },
};
