import { BRAND_NAME } from "../../lib/brand.ts";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

function conversationHref(siteUrl: string, payload: Record<string, unknown>): string | null {
  const slug = field(payload, "org_slug");
  const id = field(payload, "conversation_id");
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return url(siteUrl, `/org/${slug}/messages/${id}`);
}

// FR-P2 AC11 (step Send inquiry): an employer sent the partner an inquiry. The payload holds the connection and the
// conversation, the employer's display name and the slug of the recipient's own company; never the inquiry's text, which
// is read on the site.
export const inquiryReceived: Template = {
  subject: (payload) => `${field(payload, "org_name") ?? "An employer"} sent you an inquiry`,
  Body: ({ payload, siteUrl }) => {
    const employer = field(payload, "org_name") ?? "An employer";
    const href = conversationHref(siteUrl, payload);
    return (
      <Layout preview={`${employer} sent you an inquiry`} heading="You have a new inquiry">
        <Paragraph>{employer} found your company on {BRAND_NAME} and sent you an inquiry. Reply in the conversation.</Paragraph>
        {href ? <Action href={href}>Read the inquiry</Action> : null}
      </Layout>
    );
  },
};
