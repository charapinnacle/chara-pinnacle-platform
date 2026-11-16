import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

const LABELS: Record<string, string> = {
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Not selected",
};

// FR-O5 AC10, to the owners and admins of the partner: the employer moved a candidate the partner submitted. The payload
// holds the submission and requirement ids, the requirement as the partner knows it, the new stage and the partner's own
// slug; never the candidate, the employer's note or the reason of a decline.
export const submissionStageChanged: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `Candidate update: ${title}` : "A candidate you submitted moved to a new stage";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const status = field(payload, "status");
    const label = status ? LABELS[status] : undefined;
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    const requirement = title ? `"${title}"` : "a workforce requirement";
    return (
      <Layout preview="A candidate you submitted moved to a new stage" heading="A candidate moved to a new stage">
        <Paragraph>
          {label
            ? `A candidate you submitted for ${requirement} is now: ${label}.`
            : `The stage of a candidate you submitted for ${requirement} changed.`}
        </Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/requirements/${id}/submissions`)}>See your candidates</Action>
        ) : null}
        <Paragraph>
          You can turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
