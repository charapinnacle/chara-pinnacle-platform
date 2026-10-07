import { describe, expect, it } from "vitest";
import { applyFormSchema, applyInputSchema, CONSENT_REQUIRED, parseApplicationListParams } from "@/lib/validation/application";

const limits = { coverNoteMaxChars: 2000, documentsMax: 10 };
const form = applyFormSchema(limits);
const input = applyInputSchema(limits);

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const valid = { coverNote: "", documentIds: [] as string[], consent: true };

function messages(values: Record<string, unknown>): Record<string, string> {
  const result = form.safeParse({ ...valid, ...values });
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("the apply form schema", () => {
  it("accepts a cover note of 2000 characters and refuses one of 2001 with the message of the criteria", () => {
    expect(form.safeParse({ ...valid, coverNote: "a".repeat(2000) }).success).toBe(true);
    expect(messages({ coverNote: "a".repeat(2001) })).toEqual({ coverNote: "Cover note must be at most 2000 characters" });
  });

  it("counts the note after trimming: 2000 characters with spaces around are accepted", () => {
    const result = form.parse({ ...valid, coverNote: `  ${"a".repeat(2000)}  ` });
    expect(result.coverNote).toHaveLength(2000);
  });

  it("turns a note of only spaces into null when the action parses it", () => {
    expect(form.parse({ ...valid, coverNote: "   \n\t " }).coverNote).toBe("");
    expect(input.parse({ ...valid, coverNote: "   \n\t " }).coverNote).toBeNull();
    expect(input.parse({ ...valid, coverNote: "  hello  " }).coverNote).toBe("hello");
  });

  it("keeps markup as text, never sanitised or interpreted", () => {
    expect(input.parse({ ...valid, coverNote: "<script>alert(1)</script>" }).coverNote).toBe("<script>alert(1)</script>");
  });

  it("accepts 10 documents and refuses 11 with the limit in the message", () => {
    expect(form.safeParse({ ...valid, documentIds: Array.from({ length: 10 }, (_, i) => uuid(i)) }).success).toBe(true);
    expect(messages({ documentIds: Array.from({ length: 11 }, (_, i) => uuid(i)) })).toEqual({
      documentIds: "Select at most 10 documents",
    });
  });

  it("collapses a repeated document id to one entry, also before the count", () => {
    expect(form.parse({ ...valid, documentIds: [uuid(1), uuid(1)] }).documentIds).toEqual([uuid(1)]);
    const eleven = [...Array.from({ length: 10 }, (_, i) => uuid(i)), uuid(3)];
    expect(form.safeParse({ ...valid, documentIds: eleven }).success).toBe(true);
  });

  it("refuses an id that is not a uuid", () => {
    expect(form.safeParse({ ...valid, documentIds: ["cv"] }).success).toBe(false);
  });

  it("refuses a form whose consent is not ticked, or missing, with the message of the criteria", () => {
    expect(messages({ consent: false })).toEqual({ consent: CONSENT_REQUIRED });
    expect(messages({ consent: undefined })).toEqual({ consent: CONSENT_REQUIRED });
    expect(CONSENT_REQUIRED).toBe("Confirm that you agree to share the selected documents");
  });

  it("takes the limits it quotes from the settings", () => {
    const small = applyFormSchema({ coverNoteMaxChars: 5, documentsMax: 1 });
    expect(small.safeParse({ ...valid, coverNote: "abcdef" }).error?.issues[0].message).toBe("Cover note must be at most 5 characters");
    expect(small.safeParse({ ...valid, documentIds: [uuid(1), uuid(2)] }).error?.issues[0].message).toBe("Select at most 1 documents");
  });
});

describe("the address of the application list (FR-D3 AC2, AC10)", () => {
  it("keeps a stored stage and a page from 1 to 999", () => {
    expect(parseApplicationListParams({ stage: "interview", page: "3" })).toEqual({ stage: "interview", page: 3 });
    expect(parseApplicationListParams({ stage: "rejected", page: "999" })).toEqual({ stage: "rejected", page: 999 });
  });

  it("falls back to every stage and the first page for anything else", () => {
    for (const params of [{}, { stage: "foo", page: "0" }, { stage: "Interview", page: "-1" }, { stage: ["a", "b"], page: ["2"] }, { stage: "__proto__", page: "1000" }, { page: "2.5" }, { page: "02" }, { page: "" }]) {
      expect(parseApplicationListParams(params), JSON.stringify(params)).toEqual({ stage: null, page: 1 });
    }
  });
});
