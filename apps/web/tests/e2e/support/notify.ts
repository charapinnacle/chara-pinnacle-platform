import { createHmac, randomUUID } from "node:crypto";
import { literal, query } from "./db";

// The browser tests play the scheduler: they call the notify process that supabase/functions/serve-local.sh starts
// (playwright.config.ts defines the port and the secrets), as the minute job of the database would on a hosted project.
const notifyUrl = () => `http://127.0.0.1:${process.env.NOTIFY_PORT}`;

export async function runNotify(): Promise<{ sent: number; failed: number }> {
  const response = await fetch(notifyUrl(), {
    method: "POST",
    headers: { authorization: "Bearer scheduler", "x-edge-secret": process.env.EDGE_SHARED_SECRET ?? "" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`notify answered ${response.status}`);
  return (await response.json()) as { sent: number; failed: number };
}

// A delivery event as Resend (Svix) signs it. A wrong key or timestamp gives the signature of a forgery.
export async function sendDeliveryEvent(
  event: { type: string; data: Record<string, unknown> },
  { key = process.env.RESEND_WEBHOOK_SECRET ?? "", timestamp = Math.floor(Date.now() / 1000) } = {},
): Promise<Response> {
  const body = JSON.stringify(event);
  const id = `msg_${randomUUID()}`;
  const signature = createHmac("sha256", Buffer.from(key.replace(/^whsec_/, ""), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return fetch(notifyUrl(), {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` },
    body,
  });
}

export interface NotificationRow {
  id: string;
  user_id: string | null;
  kind: string;
  status: string;
  attempts: number;
  provider_message_id: string | null;
  last_error: string | null;
  delivery: string | null;
  sent: boolean;
}

export function notificationsOf(userId: string): NotificationRow[] {
  return query<NotificationRow>(
    `select id, user_id, kind, status, attempts, provider_message_id, last_error, delivery, sent_at is not null as sent
     from public.notifications where user_id = ${literal(userId)} order by created_at, id`,
  );
}

export function undeliverableAt(userId: string): string | null {
  const [row] = query<{ email_undeliverable_at: string | null }>(
    `select email_undeliverable_at::text from public.notification_preferences where user_id = ${literal(userId)}`,
  );
  return row?.email_undeliverable_at ?? null;
}
