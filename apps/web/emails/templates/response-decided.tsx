import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

const DECISIONS = ["shortlisted", "selected", "declined", "submissions_allowed"] as const;
type Decision = (typeof DECISIONS)[number];

const SUBJECTS: Record<Decision, string> = {
  shortlisted: "Your response is shortlisted",
  selected: "Your company is selected",
  declined: "Your response is declined",
  submissions_allowed: "You can submit candidates",
};

function decisionOf(payload: Record<string, unknown>): Decision | undefined {
  const value = field(payload, "decision");
  return DECISIONS.find((decision) => decision === value);
}

// FR-O3 step Inform (AC7): the employer decided the recipient company's response. The payload holds the response and
// requirement ids, the decision (shortlisted, selected, declined, or submissions_allowed when a shortlisted company may
// submit candidates), the requirement's own title and the employer's name once the employer is named to the company (a
// shortlist or selection reveals it; the generated title otherwise, NFR-S11) and the recipient's own slug. Never the
// note, another partner or how many responded: the note is read on the response page.
export const responseDecided: Template = {
  subject: (payload) => {
    const decision = decisionOf(payload);
    const title = field(payload, "title");
    const subject = decision ? SUBJECTS[decision] : "The employer decided your response";
    return title ? `${subject}: ${title}` : subject;
  },
  Body: ({ payload, siteUrl }) => {
    const decision = decisionOf(payload);
    const title = field(payload, "title");
    const employer = field(payload, "employer_name") ?? "The employer";
    const slug = field(payload, "org_slug");
    const id = field(payload, "response_id");
    const requirement = title ? `"${title}"` : "a workforce requirement";
    const sentence: Record<Decision, string> = {
      shortlisted: `${employer} shortlisted your company's response to ${requirement}.`,
      selected: `${employer} selected your company for ${requirement}. Your company can now submit candidates for it.`,
      declined: `${employer} declined your company's response to ${requirement}.`,
      submissions_allowed: `${employer} allows your company to submit candidates for ${requirement}.`,
    };
    return (
      <Layout preview="The employer decided your response" heading="A decision on your response">
        <Paragraph>{decision ? sentence[decision] : `${employer} decided your company's response to ${requirement}.`}</Paragraph>
        {decision === "selected" ? (
          <Paragraph>Chara Pinnacle is not a party to any agreement or payment between you and the employer.</Paragraph>
        ) : null}
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/responses/${id}`)}>See your response</Action>
        ) : null}
        <Paragraph>
          You can turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
