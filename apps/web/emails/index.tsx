import { render } from "@react-email/components";
import type { Payload } from "./payload.ts";
import type { Template } from "./template.ts";
import { applicationReceived } from "./templates/application-received.tsx";
import { deletionCompleted } from "./templates/deletion-completed.tsx";
import { deletionRequested } from "./templates/deletion-requested.tsx";
import { erasurePaused } from "./templates/erasure-paused.tsx";
import { legalVersion } from "./templates/legal-version.tsx";
import { mfaReset } from "./templates/mfa-reset.tsx";
import { paymentFailed } from "./templates/payment-failed.tsx";
import { statusChanged } from "./templates/status-changed.tsx";
import { trialEnding } from "./templates/trial-ending.tsx";
import { vacancyHidden } from "./templates/vacancy-hidden.tsx";

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
