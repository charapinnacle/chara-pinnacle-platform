import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const deletionRequested: Template = {
  subject: () => "We received your request to delete your CHARA account",
  Body: ({ payload, siteUrl }) => {
    const erases = field(payload, "erases_on");
    const date = erases && !Number.isNaN(Date.parse(erases)) ? new Date(erases).toISOString().slice(0, 10) : undefined;
    return (
      <Layout preview="Your deletion request" heading="Your account will be deleted">
        <Paragraph>
          We received your request to delete your account.{date ? ` Your data will be erased on ${date}.` : ""} Until then you can cancel the
          request in your settings.
        </Paragraph>
        <Action href={url(siteUrl, "/settings")}>Cancel the deletion</Action>
      </Layout>
    );
  },
};
