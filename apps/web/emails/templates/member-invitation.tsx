import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

const ROLES: Record<string, string> = { admin: "an administrator", member: "a member" };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function expiry(value: string | undefined): string {
  const date = value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : undefined;
  return date ? `It is valid until ${date} and can be used once.` : "It can be used once and expires.";
}

export const memberInvitation: Template = {
  subject: (payload) => `You are invited to join ${field(payload, "org_name") ?? "a team"} on CHARA`,
  Body: ({ payload, siteUrl }) => {
    const organisation = field(payload, "org_name") ?? "An organisation";
    const role = ROLES[field(payload, "role") ?? ""] ?? "a member";
    const token = field(payload, "token");
    return (
      <Layout preview={`${organisation} invited you to join its team`} heading="You are invited to a team on CHARA">
        <Paragraph>
          {organisation} invited you to join its team on CHARA as {role}. {expiry(field(payload, "expires_at"))}
        </Paragraph>
        {token && TOKEN.test(token) ? <Action href={url(siteUrl, `/invitations/${token}`)}>View the invitation</Action> : null}
        <Paragraph>
          You need a CHARA employer account with this email address to accept. If you were not expecting this invitation, ignore
          this email: nothing happens unless you accept.
        </Paragraph>
      </Layout>
    );
  },
};
