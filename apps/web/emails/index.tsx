import { render } from "@react-email/components";
import type { Payload } from "./payload.ts";
import type { Template } from "./template.ts";
import { accountExists } from "./templates/account-exists.tsx";
import { accountReinstated } from "./templates/account-reinstated.tsx";
import { accountSuspended } from "./templates/account-suspended.tsx";
import { applicationReceived } from "./templates/application-received.tsx";
import { contactRequestDecided } from "./templates/contact-request-decided.tsx";
import { contactRequestReceived } from "./templates/contact-request-received.tsx";
import { dataExportReady } from "./templates/data-export-ready.tsx";
import { deletionCompleted } from "./templates/deletion-completed.tsx";
import { deletionRequested } from "./templates/deletion-requested.tsx";
import { erasurePaused } from "./templates/erasure-paused.tsx";
import { followedCompanyActivity } from "./templates/followed-company-activity.tsx";
import { invitationReceived } from "./templates/invitation-received.tsx";
import { invitationWithdrawn } from "./templates/invitation-withdrawn.tsx";
import { jobOrderMatch } from "./templates/job-order-match.tsx";
import { legalVersion } from "./templates/legal-version.tsx";
import { licenceExpiring } from "./templates/licence-expiring.tsx";
import { listingConfirmationDue } from "./templates/listing-confirmation-due.tsx";
import { memberInvitation } from "./templates/member-invitation.tsx";
import { mfaReset } from "./templates/mfa-reset.tsx";
import { moderationDecision } from "./templates/moderation-decision.tsx";
import { newMessage } from "./templates/new-message.tsx";
import { partnerApproved } from "./templates/partner-approved.tsx";
import { partnerDeclined } from "./templates/partner-declined.tsx";
import { partnerInfoRequested } from "./templates/partner-info-requested.tsx";
import { partnerLicenceExpired } from "./templates/partner-licence-expired.tsx";
import { paymentFailed } from "./templates/payment-failed.tsx";
import { requirementChanged } from "./templates/requirement-changed.tsx";
import { requirementClosed } from "./templates/requirement-closed.tsx";
import { requirementClosingSoon } from "./templates/requirement-closing-soon.tsx";
import { responseDecided } from "./templates/response-decided.tsx";
import { responseReceived } from "./templates/response-received.tsx";
import { responseWithdrawn } from "./templates/response-withdrawn.tsx";
import { statusChanged } from "./templates/status-changed.tsx";
import { submissionApproved } from "./templates/submission-approved.tsx";
import { submissionRequest } from "./templates/submission-request.tsx";
import { submissionRequestSignup } from "./templates/submission-request-signup.tsx";
import { submissionStageChanged } from "./templates/submission-stage-changed.tsx";
import { submissionWithdrawn } from "./templates/submission-withdrawn.tsx";
import { trialEnding } from "./templates/trial-ending.tsx";
import { vacancyHidden } from "./templates/vacancy-hidden.tsx";
import { visibilityConfirmation } from "./templates/visibility-confirmation.tsx";

const TEMPLATES = {
  application_received: applicationReceived,
  status_changed: statusChanged,
  vacancy_hidden: vacancyHidden,
  trial_ending: trialEnding,
  payment_failed: paymentFailed,
  legal_version: legalVersion,
  mfa_reset: mfaReset,
  deletion_requested: deletionRequested,
  deletion_completed: deletionCompleted,
  erasure_paused: erasurePaused,
  account_suspended: accountSuspended,
  account_reinstated: accountReinstated,
  member_invitation: memberInvitation,
  account_exists: accountExists,
  partner_approved: partnerApproved,
  partner_info_requested: partnerInfoRequested,
  partner_declined: partnerDeclined,
  licence_expiring: licenceExpiring,
  partner_licence_expired: partnerLicenceExpired,
  listing_confirmation_due: listingConfirmationDue,
  followed_company_activity: followedCompanyActivity,
  moderation_decision: moderationDecision,
  data_export_ready: dataExportReady,
  requirement_closing_soon: requirementClosingSoon,
  job_order_match: jobOrderMatch,
  invitation_received: invitationReceived,
  invitation_withdrawn: invitationWithdrawn,
  requirement_changed: requirementChanged,
  requirement_closed: requirementClosed,
  response_received: responseReceived,
  response_withdrawn: responseWithdrawn,
  response_decided: responseDecided,
  new_message: newMessage,
  submission_request: submissionRequest,
  submission_request_signup: submissionRequestSignup,
  submission_approved: submissionApproved,
  submission_withdrawn: submissionWithdrawn,
  submission_stage_changed: submissionStageChanged,
  visibility_confirmation: visibilityConfirmation,
  contact_request_received: contactRequestReceived,
  contact_request_decided: contactRequestDecided,
} as const satisfies Record<string, Template>;

export type NotificationKind = keyof typeof TEMPLATES;

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && Object.hasOwn(TEMPLATES, value);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// The subject is one line whatever the payload holds.
export async function renderEmail(kind: NotificationKind, payload: Payload, siteUrl: string): Promise<RenderedEmail> {
  const template: Template = TEMPLATES[kind];
  const element = <template.Body payload={payload} siteUrl={siteUrl} />;
  return {
    subject: template.subject(payload).replace(/\s+/g, " ").trim(),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
