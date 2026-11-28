import "server-only";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

// The workforce corridors and the network view (brief sections 18 to 20; 20270305100000_workforce_corridors.sql). The
// database answers aggregates only: a count it holds back below stats_min_count is null, the workforce a range or null.
// It answers CHARA_NOT_FOUND (P0002) while release_corridors is off and for an address that is not a corridor or a
// country; the reads below answer null then, so the page is not found. The workforce range comes only to a signed-in
// caller (workforce_requires_sign_in false): the client carries the session cookie, and the pages render per request.

const count = z.number().int().nullable();
const range = z.string().nullable();

const corridorRowSchema = z.object({
  source_country: z.string(),
  source_name: z.string(),
  destination_country: z.string(),
  destination_name: z.string(),
  recruitment_partners: count,
  staffing_partners: count,
  workers_available: range,
});

const corridorListSchema = z.object({
  min_count: z.number().int(),
  workforce_requires_sign_in: z.boolean(),
  refreshed_at: z.string().nullable(),
  corridors: z.array(corridorRowSchema),
});

const corridorSchema = corridorRowSchema.extend({
  listed: z.boolean(),
  min_count: z.number().int(),
  workforce_requires_sign_in: z.boolean(),
  refreshed_at: z.string().nullable(),
  industries: z.array(z.object({ code: z.string(), name: z.string() })),
});

const countrySchema = z.object({ code: z.string(), name: z.string(), partners: z.number().int() });
const figures = { recruitment_partners: count, staffing_partners: count, workers_available: range };

const networkSchema = z.object({
  destination_country: z.string(),
  destination_name: z.string(),
  min_count: z.number().int(),
  workforce_requires_sign_in: z.boolean(),
  refreshed_at: z.string().nullable(),
  industries: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      ...figures,
      occupations: z.array(
        z.object({
          code: z.string(),
          label: z.string(),
          ...figures,
          recruitment_sources: z.array(countrySchema),
          staffing_bases: z.array(countrySchema),
        }),
      ),
    }),
  ),
});

export type CorridorRow = z.infer<typeof corridorRowSchema>;
export type CorridorList = z.infer<typeof corridorListSchema>;
export type Corridor = z.infer<typeof corridorSchema>;
export type Network = z.infer<typeof networkSchema>;

const isNotFound = (error: { code?: string }) => error.code === "P0002";

export async function listCorridors(): Promise<CorridorList | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_corridors");
  if (error) {
    if (isNotFound(error)) return null;
    throw new Error("The workforce corridors could not be loaded", { cause: error });
  }
  return corridorListSchema.parse(data);
}

export async function getCorridor(source: string, destination: string): Promise<Corridor | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_corridor", { p_source: source, p_destination: destination });
  if (error) {
    if (isNotFound(error)) return null;
    throw new Error("The workforce corridor could not be loaded", { cause: error });
  }
  return corridorSchema.parse(data);
}

export async function getNetwork(destination: string): Promise<Network | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_network", { p_destination: destination });
  if (error) {
    if (isNotFound(error)) return null;
    throw new Error("The network could not be loaded", { cause: error });
  }
  return networkSchema.parse(data);
}
