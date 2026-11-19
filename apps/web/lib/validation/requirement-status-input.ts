import * as z from "zod";

// Kept apart from requirement-status.ts, which the status actions load in the browser: only the server actions parse these,
// and z.discriminatedUnion would grow the one zod module that every page with a form loads, the home page included.
// The requirement an action changes, with the version (updated_at) the page was drawn with.
export const requirementTargetSchema = z.object({ id: z.uuid(), expectedUpdatedAt: z.iso.datetime({ offset: true }) });
export type RequirementTarget = z.input<typeof requirementTargetSchema>;

// The changes of set_requirement_status the page offers; a draft is opened by publishing it.
export const statusChangeSchema = z.discriminatedUnion("to", [
  z.object({ to: z.enum(["paused", "open", "filled"]) }),
  z.object({ to: z.literal("closed"), reason: z.literal("cancelled") }),
]);
export type StatusChange = z.input<typeof statusChangeSchema>;
