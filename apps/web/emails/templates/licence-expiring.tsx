import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const licenceExpiring: Template = {
  subject: (payload) => {
    const country = field(payload, "country_name");
    const date = longDate(field(payload, "valid_until"));
    return `Your licence${country ? ` for ${country}` : ""} expires ${date ? `on ${date}` : "soon"}`;
  },
  Body: ({ payload, siteUrl }) => {
    const country = field(payload, "country_name");
    const date = longDate(field(payload, "valid_until"));
    const org = field(payload, "org_name");
    const slug = field(payload, "org_slug");
    return (
      <Layout preview={`A licence expires ${date ? `on ${date}` : "soon"}`} heading="A licence expires soon">
        <Paragraph>
          The licence{org ? ` ${org} recorded` : " you recorded"}
          {country ? ` for ${country}` : ""} is valid until {date ?? "a date that is coming up"}. Once that date has passed it no
          longer counts as a current licence.
        </Paragraph>
        <Paragraph>If it was renewed, update the entry with the new date on your workforce profile.</Paragraph>
        {slug ? <Action href={url(siteUrl, `/org/${slug}/workforce-profile#licences-heading`)}>Update your licences</Action> : null}
      </Layout>
    );
  },
};
