import { describe, expect, it } from "vitest";
import { stageChangeFormSchema, stageChangeInputSchema } from "@/lib/validation/applicant";

describe("stageChangeInputSchema", () => {
  it.each(["shortlisted", "interview", "offer", "hired", "rejected"])("accepts the target %s", (status) => {
    expect(stageChangeInputSchema.parse({ status, note: "" })).toEqual({ status, note: "" });
  });

  it.each(["", "applied", "viewed", "withdrawn", "Interview", "elsewhere"])("refuses the target '%s'", (status) => {
    const result = stageChangeInputSchema.safeParse({ status, note: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Choose a stage");
  });

  it("trims the note and keeps an empty one empty", () => {
    expect(stageChangeInputSchema.parse({ status: "rejected", note: "  Position filled  " }).note).toBe("Position filled");
    expect(stageChangeInputSchema.parse({ status: "rejected", note: "   " }).note).toBe("");
  });

  it("takes no limit on the note, which the database enforces", () => {
    expect(stageChangeInputSchema.safeParse({ status: "offer", note: "a".repeat(5000) }).success).toBe(true);
  });
});

describe("stageChangeFormSchema", () => {
  const schema = stageChangeFormSchema(1000);

  it("accepts a note of the limit and refuses one character more, after trimming", () => {
    expect(schema.safeParse({ status: "offer", note: `  ${"a".repeat(1000)}  ` }).success).toBe(true);
    const over = schema.safeParse({ status: "offer", note: "a".repeat(1001) });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0].message).toBe("Note must be at most 1000 characters");
  });

  it("quotes the limit it was built with", () => {
    expect(stageChangeFormSchema(5).safeParse({ status: "offer", note: "abcdef" }).error?.issues[0].message).toBe(
      "Note must be at most 5 characters",
    );
  });
});
