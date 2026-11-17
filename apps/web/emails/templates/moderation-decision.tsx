import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// One kind, three readers (FR-S1 steps Inform and Appeal): the affected company reads the decision, the reasons and the
// appeal; a signed-in reporter reads only the outcome of the report, never the reasons or who was reported (FR-J3 AC10);
// the appellant reads the outcome of the appeal with its reasons (AC9).
function isReporterNotice(payload: Record<string, unknown>): boolean {
  return field(payload, "reference") !== undefined;
}

function isAppealNotice(payload: Record<string, unknown>): boolean {
  return field(payload, "appeal_outcome") !== undefined;
}

const targetNames: Record<string, string> = {
  partner_profile: "partner profile",
  job: "vacancy",
  organization: "organisation",
  requirement: "requirement",
  partner_response: "response to",
  candidate_submission: "candidate submission for",
  message: "message",
  contact_request: "contact request",
};

// A message or a contact request (V73), named by its kind, never its text. The decision page holds the reasons and the
// appeal; the sender of a message may appeal it, as the owner or an admin may appeal a contact request.
function sentItem(payload: Record<string, unknown>) {
  const type = field(payload, "target_type");
  if (type !== "message" && type !== "contact_request") return null;
  return { name: targetNames[type], message: type === "message" };
}

// A job order, response or submission of the organisation (V57): its kind, its title as the organisation knows it, and
// the page where the organisation reads the decision.
function moderatedItem(payload: Record<string, unknown>) {
  const type = field(payload, "target_type");
  if (type !== "requirement" && type !== "partner_response" && type !== "candidate_submission") return null;
  const slug = field(payload, "org_slug");
  const id = field(payload, "target_id");
  const path =
    !slug || !id
      ? null
      : type === "requirement"
        ? `/org/${slug}/requirements/${id}`
        : type === "partner_response"
          ? `/org/${slug}/responses/${id}`
          : `/org/${slug}/submissions`;
  return { name: `${targetNames[type]} ${field(payload, "title") ?? "a job order"}`, path };
}

export const moderationDecision: Template = {
  subject: (payload) => {
    if (isReporterNotice(payload)) return `Your report ${field(payload, "reference")} was closed`;
    if (isAppealNotice(payload)) {
      const sent = sentItem(payload);
      const about = sent ? `your ${sent.name}` : field(payload, "title");
      return about ? `Your appeal about ${about} was decided` : "Your appeal was decided";
    }
    const sent = sentItem(payload);
    if (sent) return field(payload, "decision") === "unhide" ? `Your ${sent.name} is shown again` : `Your ${sent.name} was hidden by moderation`;
    const item = moderatedItem(payload);
    if (item) return field(payload, "decision") === "unhide" ? `Your ${item.name} is shown again` : `Your ${item.name} was hidden by moderation`;
    const title = field(payload, "title") ?? "Your partner profile";
    return field(payload, "decision") === "unhide" ? `${title} is shown again` : `${title} was hidden by moderation`;
  },
  Body: ({ payload, siteUrl }) => {
    const decision = field(payload, "moderation_action_id");
    if (isReporterNotice(payload)) {
      const reference = field(payload, "reference");
      const actioned = field(payload, "outcome") === "actioned";
      return (
        <Layout preview={`Your report ${reference} was closed`} heading="Your report was closed">
          <Paragraph>
            Our moderators closed your report {reference}.{" "}
            {actioned ? "They took action on what you reported." : "They decided that no action was needed."}
          </Paragraph>
          <Action href={url(siteUrl, "/reports")}>See your reports</Action>
          {actioned ? null : (
            <Paragraph>
              If you disagree with this outcome, see the{" "}
              <a href={url(siteUrl, "/legal/complaints-and-dispute-process")}>Complaints and Dispute Process</a>.
            </Paragraph>
          )}
        </Layout>
      );
    }
    if (isAppealNotice(payload)) {
      const restored = field(payload, "appeal_outcome") === "restored";
      const target = targetNames[field(payload, "target_type") ?? ""] ?? "item";
      const title = sentItem(payload) ? undefined : field(payload, "title");
      const reasons = field(payload, "reasons");
      const subject = title ? `the ${target} ${title}` : `your ${target}`;
      return (
        <Layout
          preview={restored ? "Your appeal was successful" : "Your appeal was not successful"}
          heading={restored ? "We reversed the decision" : "We upheld the decision"}
        >
          <Paragraph>
            {restored
              ? `A second moderator reviewed your appeal about ${subject} and reversed the decision. The reasons:`
              : `A second moderator reviewed your appeal about ${subject} and kept the decision in place. The reasons:`}
          </Paragraph>
          {reasons ? <Quote>{reasons}</Quote> : null}
          {decision ? <Action href={url(siteUrl, `/appeals/${decision}`)}>See the decision and the appeal</Action> : null}
        </Layout>
      );
    }
    const reasons = field(payload, "reasons");
    const unhidden = field(payload, "decision") === "unhide";
    const sent = sentItem(payload);
    if (sent) {
      return (
        <Layout
          preview={unhidden ? `Your ${sent.name} is shown again` : `Your ${sent.name} was hidden by moderation`}
          heading={unhidden ? "Shown again after moderation" : "Hidden by moderation"}
        >
          <Paragraph>
            {unhidden
              ? `Our moderators made your ${sent.name} visible again. The reasons:`
              : `Our moderators hid your ${sent.name}. The other party no longer sees it. The reasons:`}
          </Paragraph>
          {reasons ? <Quote>{reasons}</Quote> : null}
          {unhidden || !decision ? null : (
            <>
              <Paragraph>
                {sent.message
                  ? "If you think this was a mistake, the person who sent it, or the owner or an admin of the company, can appeal. A moderator who did not take the decision reviews the appeal."
                  : "If you think this was a mistake, the owner or an admin can appeal. A moderator who did not take the decision reviews the appeal."}
              </Paragraph>
              <Action href={url(siteUrl, `/appeals/${decision}`)}>See the decision and appeal</Action>
            </>
          )}
        </Layout>
      );
    }
    const item = moderatedItem(payload);
    if (item) {
      return (
        <Layout
          preview={unhidden ? `Your ${item.name} is shown again` : `Your ${item.name} was hidden by moderation`}
          heading={unhidden ? "Shown again after moderation" : "Hidden by moderation"}
        >
          <Paragraph>
            {unhidden
              ? `Our moderators made your ${item.name} visible again. The reasons:`
              : `Our moderators hid your ${item.name}. The other party no longer sees it and it cannot be acted on. The reasons:`}
          </Paragraph>
          {reasons ? <Quote>{reasons}</Quote> : null}
          {unhidden || !decision ? null : (
            <>
              <Paragraph>
                If you think this was a mistake, the owner or an admin can appeal. A moderator who did not take the decision reviews the
                appeal.
              </Paragraph>
              <Action href={url(siteUrl, `/appeals/${decision}`)}>Appeal this decision</Action>
            </>
          )}
          {item.path ? (
            <Paragraph>
              <a href={url(siteUrl, item.path)}>Open it</a>
            </Paragraph>
          ) : null}
        </Layout>
      );
    }
    const title = field(payload, "title") ?? "your partner profile";
    const slug = field(payload, "org_slug");
    return (
      <Layout
        preview={unhidden ? `${title} is shown again` : `${title} was hidden by moderation`}
        heading={unhidden ? "Your partner profile is shown again" : "Your partner profile was hidden"}
      >
        <Paragraph>
          {unhidden
            ? `Our moderators made the partner profile of ${title} public again. The reasons:`
            : `Our moderators hid the partner profile of ${title}. It is no longer shown in the partner directories or to employers. The reasons:`}
        </Paragraph>
        {reasons ? <Quote>{reasons}</Quote> : null}
        {unhidden ? null : decision ? (
          <>
            <Paragraph>
              If you think this was a mistake, the owner or an admin can appeal. A moderator who did not take the decision reviews the
              appeal.
            </Paragraph>
            <Action href={url(siteUrl, `/appeals/${decision}`)}>Appeal this decision</Action>
          </>
        ) : (
          <>
            <Paragraph>
              If you think this was a mistake, you can appeal. The route is described on the Complaints and Dispute Process page.
            </Paragraph>
            <Action href={url(siteUrl, "/legal/complaints-and-dispute-process")}>How to appeal</Action>
          </>
        )}
        {slug ? (
          <Paragraph>
            <a href={url(siteUrl, `/org/${slug}/workforce-profile${unhidden ? "" : "#moderation-heading"}`)}>Open your workforce profile</a>
          </Paragraph>
        ) : null}
      </Layout>
    );
  },
};
