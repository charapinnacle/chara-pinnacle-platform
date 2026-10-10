// The browser bundle of "zod" holds all its translations (170 KB) when a module imports its namespace. The names listed
// here are the ones the application uses: only those, and what they need, reach a page.
export { array, boolean, coerce, custom, email, enum, instanceof, iso, literal, number, object, record, strictObject, string, tuple, union, url, uuid } from "zod";
export type { infer, input, output, ZodError, ZodType } from "zod";
export type { ParsePayload } from "zod/v4/core";
