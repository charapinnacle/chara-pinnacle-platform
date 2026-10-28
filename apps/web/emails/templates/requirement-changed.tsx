import { Link } from "@react-email/components";
import { changedFieldsText } from "../../lib/requirements/change-fields.ts";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-M2 step Edit: the employer changed a workforce requirement the recipient's company is invited to. The payload holds
// the invitation id, the requirement's title and the employer's display name (both revealed by the invitation), the
// fields changed (edits made while the notice waited are joined to it), never their values, and the recipient's own slug.
export const requirementChanged: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `Workforce requirement changed: ${title}` : "A workforce requirement you are invited to changed";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const employer = field(payload, "employer_name");
    const fields = changedFieldsText(payload.changed_fields);
    const slug = field(payload, "org_slug");
    const id = field(payload, "invitation_id");
    return (
      <Layout preview="A workforce requirement you are invited to changed" heading="A workforce requirement changed">
        <Paragraph>
          {employer ?? "The employer"} changed {title ? `"${title}"` : "a workforce requirement"}, which your company is invited to.
        </Paragraph>
        {fields ? <Paragraph>Changed: {fields}.</Paragraph> : null}
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/invitations/${id}#changes`)}>See what changed</Action>
        ) : null}
        <Paragraph>
          The invitation shows the old and the new values. You can turn these emails off in your{" "}
          <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
