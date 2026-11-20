import "server-only";
import * as z from "zod";
import type { ConversationConnection } from "@/lib/connections/typed-messages";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getCountries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";

const connectionSchema = z.object({
  id: z.uuid(),
  message_id: z.uuid().nullable(),
  kind: z.enum(["inquiry", "request_workforce", "invite_to_job", "submit_candidate"]),
  status: z.enum(["sent", "answered", "accepted", "declined"]),
  sent_by_me: z.boolean(),
  job_id: z.uuid().nullable(),
  job_title: z.string().nullable(),
  job_city: z.string().nullable(),
  job_country_code: z.string().nullable(),
  job_open: z.boolean(),
  requirement_title: z.string().nullable(),
  occupation_label: z.string().nullable(),
  quantity: z.number().int().nullable(),
  destination_country: z.string().nullable(),
  start_date: z.string().nullable(),
});

// The connections of a conversation keyed by their typed message, for the cards of the thread (FR-P2 AC5, AC10; SOP step
// Track). Country codes are named from the code list.
export async function listConversationConnections(conversationId: string): Promise<Record<string, ConversationConnection>> {
  const supabase = await createClient();
  const [{ data, error }, countries] = await Promise.all([
    supabase.rpc("list_conversation_connections", { p_conversation: conversationId }),
    getCountries(),
  ]);
  if (error) throw new Error("The actions of the conversation could not be loaded", { cause: error });
  const countryName = (code: string | null) => (code ? (countries.find((country) => country.code === code)?.name ?? code) : null);
  const byMessage: Record<string, ConversationConnection> = {};
  for (const row of z.array(connectionSchema).parse(data)) {
    if (!row.message_id) continue;
    byMessage[row.message_id] = {
      id: row.id,
      messageId: row.message_id,
      kind: row.kind,
      status: row.status,
      sentByMe: row.sent_by_me,
      jobId: row.job_id,
      jobTitle: row.job_title,
      jobPlace: [row.job_city, countryName(row.job_country_code)].filter(Boolean).join(", ") || null,
      jobOpen: row.job_open,
      requirementTitle: row.requirement_title,
      occupation: row.occupation_label,
      quantity: row.quantity,
      destination: countryName(row.destination_country),
      startDate: row.start_date,
    };
  }
  return byMessage;
}

export type ContactEmployer = {
  id: string;
  slug: string;
  displayName: string;
  // Request workforce is for owners and admins (FR-P2 roles), at aal2 as every requirement.
  manager: boolean;
};

// The employer a signed-in member contacts a partner for from its public profile (FR-P2 AC9; SOP steps Send inquiry and
// Request workforce): the employer saveFor names (the one Save partner saves for), while release 2c's messaging is on;
// null for a visitor, a worker, a member of partners only, and a suspended account or employer.
export async function getContactEmployer(saveFor: string | null): Promise<ContactEmployer | null> {
  if (!saveFor || !(await isReleased("release_messaging"))) return null;
  const user = await getCurrentUser();
  if (!user || user.suspended || user.accountKind !== "company") return null;
  const employer = (await getMyOrganizations(user.id)).find(
    ({ id, type, suspended }) => id === saveFor && type === "employer" && !suspended,
  );
  return employer
    ? { id: employer.id, slug: employer.slug, displayName: employer.displayName, manager: employer.role !== "member" }
    : null;
}
