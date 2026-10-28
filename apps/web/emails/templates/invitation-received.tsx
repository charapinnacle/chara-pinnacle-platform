import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-O1 step Notify: an employer invited the recipient's company to a workforce requirement. The payload holds the
// invitation id, the title, the destination, the number of workers, the start date, the employer's name only when its
// requirement shows it on the marketplace (otherwise the title is the generated one) and the slug of the recipient's own
// company. An email leaves the platform, so it never names an employer that is anonymous (NFR-S11); the invitation page
// shows the name after sign-in.
export const invitationReceived: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `Invitation to a workforce requirement: ${title}` : "Your company is invited to a workforce requirement";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const employer = field(payload, "employer_name");
    const country = field(payload, "country_name");
    const workers = field(payload, "workers_needed");
    const start = longDate(field(payload, "start_date"));
    const slug = field(payload, "org_slug");
    const id = field(payload, "invitation_id");
    return (
      <Layout preview="Your company is invited to a workforce requirement" heading="Your company is invited to a workforce requirement">
        <Paragraph>
          {employer ?? "An employer"} invited your company to {title ? `"${title}"` : "a workforce requirement"}
          {country ? ` in ${country}` : ""}.
        </Paragraph>
        {workers || start ? (
          <Paragraph>
            {workers ? `Workers needed: ${workers}.` : ""}
            {workers && start ? " " : ""}
            {start ? `Start: ${start}.` : ""}
          </Paragraph>
        ) : null}
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/invitations/${id}`)}>See the invitation</Action>
        ) : null}
        <Paragraph>
          Open the invitation to read the requirement and accept or decline it. You can turn these emails off in your{" "}
          <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
