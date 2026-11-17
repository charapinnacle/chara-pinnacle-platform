import "server-only";
import * as z from "zod";
import { contactRequestStatuses, type ContactRequestStatus } from "@/lib/contact-requests/presentation";
import type { ContactRequestCounts } from "@/lib/dashboard/connections";
import { createClient } from "@/lib/supabase/server";

export const CONTACT_REQUESTS_PAGE_SIZE = 20;

const statusSchema = z.enum(contactRequestStatuses);

const sentSchema = z.object({
  id: z.uuid(),
  card_id: z.uuid(),
  status: statusSchema,
  message: z.string(),
  job_title: z.string().nullable(),
  destination_country: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  responded_at: z.string().nullable(),
  sent_by_me: z.boolean(),
  card_listed: z.boolean(),
  headline: z.string().nullable(),
  occupation_id: z.string().nullable(),
  current_country: z.string().nullable(),
  worker_first_name: z.string().nullable(),
  worker_last_name: z.string().nullable(),
  conversation_id: z.uuid().nullable(),
  moderation_state: z.enum(["visible", "hidden", "org_suspended"]),
  moderation_action_id: z.number().int().nullable(),
});

// One request of the organisation as list_contact_requests_sent answers it: the card fields while the card is listed and,
// only once the worker accepted, the worker's first and last name and the conversation (FR-Q3 AC7, NFR-S9).
export type SentContactRequest = {
  id: string;
  cardId: string;
  status: ContactRequestStatus;
  message: string;
  jobTitle: string | null;
  destinationCountry: string | null;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  sentByMe: boolean;
  headline: string | null;
  occupationId: string | null;
  currentCountry: string | null;
  workerName: string | null;
  conversationId: string | null;
  // The decision that hid the request (FR-S1, V73); null while the worker sees it.
  hiddenBy: number | null;
};

export type SentContactRequestsPage = { items: SentContactRequest[]; nextCursor: string | null };

// The requests organizationId sent, newest first, a page of 20 after the cursor (created_at|id of the last row shown).
export async function listSentContactRequests(
  organizationId: string,
  { status, cursor }: { status: ContactRequestStatus | null; cursor: { at: string; id: string } | null },
): Promise<SentContactRequestsPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_contact_requests_sent", {
    p_org: organizationId,
    p_limit: CONTACT_REQUESTS_PAGE_SIZE + 1,
    ...(status ? { p_status: status } : {}),
    ...(cursor ? { p_before_at: cursor.at, p_before_id: cursor.id } : {}),
  });
  if (error) throw new Error("The contact requests could not be loaded", { cause: error });
  const rows = z.array(sentSchema).parse(data);
  const items = rows.slice(0, CONTACT_REQUESTS_PAGE_SIZE).map((row) => ({
    id: row.id,
    cardId: row.card_id,
    status: row.status,
    message: row.message,
    jobTitle: row.job_title,
    destinationCountry: row.destination_country,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
    sentByMe: row.sent_by_me,
    headline: row.headline,
    occupationId: row.occupation_id,
    currentCountry: row.current_country,
    workerName: row.status === "accepted" ? [row.worker_first_name, row.worker_last_name].filter(Boolean).join(" ") || null : null,
    conversationId: row.conversation_id,
    hiddenBy: row.moderation_state === "hidden" ? row.moderation_action_id : null,
  }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > CONTACT_REQUESTS_PAGE_SIZE && last ? `${last.createdAt}|${last.id}` : null };
}

const receivedSchema = z.object({
  id: z.uuid(),
  status: statusSchema,
  message: z.string(),
  organization_name: z.string(),
  organization_type: z.enum(["employer", "recruitment_company", "staffing_company"]),
  organization_country: z.string().nullable(),
  job_id: z.uuid().nullable(),
  job_title: z.string().nullable(),
  job_country: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  responded_at: z.string().nullable(),
  conversation_id: z.uuid().nullable(),
});

export type ReceivedContactRequest = {
  id: string;
  status: ContactRequestStatus;
  message: string;
  organizationName: string;
  organizationType: z.infer<typeof receivedSchema>["organization_type"];
  organizationCountry: string | null;
  jobId: string | null;
  jobTitle: string | null;
  jobCountry: string | null;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  conversationId: string | null;
};

// The worker's own requests, those waiting for an answer first (FR-Q3 AC11).
export async function listReceivedContactRequests(): Promise<ReceivedContactRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_contact_requests_received", { p_limit: 100 });
  if (error) throw new Error("Your contact requests could not be loaded", { cause: error });
  return z
    .array(receivedSchema)
    .parse(data)
    .map((row) => ({
      id: row.id,
      status: row.status,
      message: row.message,
      organizationName: row.organization_name,
      organizationType: row.organization_type,
      organizationCountry: row.organization_country,
      jobId: row.job_id,
      jobTitle: row.job_title,
      jobCountry: row.job_country,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      respondedAt: row.responded_at,
      conversationId: row.conversation_id,
    }));
}

const cardStateSchema = z.object({
  card_id: z.uuid(),
  request_id: z.uuid(),
  status: statusSchema,
  created_at: z.string(),
  can_send: z.boolean(),
});

export type CardContactState = { requestId: string; status: ContactRequestStatus; sentAt: string; canSend: boolean };

// The latest request of the organisation to each card of a page, for the card's Send button (FR-Q3 AC12).
export async function cardContactRequests(organizationId: string, cardIds: readonly string[]): Promise<Map<string, CardContactState>> {
  if (cardIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("card_contact_requests", { p_org: organizationId, p_cards: [...cardIds] });
  if (error) throw new Error("The contact requests could not be loaded", { cause: error });
  return new Map(
    z
      .array(cardStateSchema)
      .parse(data)
      .map((row) => [row.card_id, { requestId: row.request_id, status: row.status, sentAt: row.created_at, canSend: row.can_send }]),
  );
}

export type OpenVacancy = { id: string; title: string };

// The open, visible vacancies of the organisation a request may invite the worker to (decision 4.4).
export async function listOpenVacancies(organizationId: string): Promise<OpenVacancy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .eq("moderation_state", "visible")
    .is("deleted_at", null)
    .order("title");
  if (error) throw new Error("The vacancies could not be loaded", { cause: error });
  return data;
}

const countsSchema = z.object({ pending: z.number().int().nonnegative(), received: z.number().int().nonnegative() });

// The worker's own contact requests for the Find Workers card of the dashboard (FR-Q1 AC10). Release 2c must be on (the
// caller checks isReleased first).
export async function getMyContactRequestCounts(): Promise<ContactRequestCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_contact_request_counts").single();
  if (error) throw new Error("The contact requests could not be counted", { cause: error });
  return countsSchema.parse(data);
}
