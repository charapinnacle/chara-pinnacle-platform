import { describe, expect, it } from "vitest";
import {
  BULK_MAX,
  bulkActionFormSchema,
  bulkActionInputSchema,
  declineReasonOptions,
  noteInputSchema,
  stageChangeFormSchema,
  stageChangeInputSchema,
} from "@/lib/validation/applicant";

describe("stageChangeInputSchema", () => {
  it.each(["shortlisted", "interview", "offer", "hired"])("accepts the target %s with no note", (status) => {
    expect(stageChangeInputSchema.parse({ status, note: "" })).toEqual({ status, note: "" });
  });

  it.each(["", "applied", "viewed", "withdrawn", "Interview", "elsewhere"])("refuses the target '%s'", (status) => {
    const result = stageChangeInputSchema.safeParse({ status, note: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Choose a stage");
  });

  it("trims the note and keeps an empty one empty", () => {
    expect(stageChangeInputSchema.parse({ status: "offer", note: "  Start in May  " }).note).toBe("Start in May");
    expect(stageChangeInputSchema.parse({ status: "offer", note: "   " }).note).toBe("");
  });

  it("takes no limit on the note, which the database enforces", () => {
    expect(stageChangeInputSchema.safeParse({ status: "offer", note: "a".repeat(5000) }).success).toBe(true);
  });

  it("needs a reason for a decline, and trims it", () => {
    expect(stageChangeInputSchema.parse({ status: "rejected", note: "  Position filled  " })).toEqual({ status: "rejected", note: "Position filled" });
    for (const note of ["", "   ", "\n\t"]) {
      const result = stageChangeInputSchema.safeParse({ status: "rejected", note });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["note"], message: "Enter a reason" });
    }
  });
});

describe("stageChangeFormSchema", () => {
  const schema = stageChangeFormSchema(1000);

  it("accepts a note of the limit and refuses one character more, after trimming", () => {
    expect(schema.safeParse({ status: "offer", reason: "", note: `  ${"a".repeat(1000)}  ` }).success).toBe(true);
    const over = schema.safeParse({ status: "offer", reason: "", note: "a".repeat(1001) });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0].message).toBe("Note must be at most 1000 characters");
  });

  it("quotes the limit it was built with", () => {
    expect(stageChangeFormSchema(5).safeParse({ status: "offer", reason: "", note: "abcdef" }).error?.issues[0].message).toBe(
      "Note must be at most 5 characters",
    );
  });

  it("ignores the reason for a stage other than Not selected", () => {
    expect(schema.parse({ status: "interview", reason: "position_filled", note: "Week 41" })).toMatchObject({ status: "interview", note: "Week 41" });
  });

  it.each([
    ["position_filled", "Position filled"],
    ["qualifications_not_matching", "Qualifications do not match the requirements of this role"],
  ])("turns the template %s into its text as the note of a decline", (reason, text) => {
    expect(schema.parse({ status: "rejected", reason, note: "" })).toMatchObject({ status: "rejected", note: text });
  });

  it("offers the two templates and Other, with the wording the candidate reads", () => {
    expect(declineReasonOptions).toEqual([
      { value: "position_filled", label: "Position filled" },
      { value: "qualifications_not_matching", label: "Qualifications do not match the requirements of this role" },
      { value: "other", label: "Other" },
    ]);
  });

  it("takes the typed text as the reason of a decline with Other, 1 to the limit of characters", () => {
    expect(schema.parse({ status: "rejected", reason: "other", note: "  Moved abroad  " })).toMatchObject({ note: "Moved abroad" });
    expect(schema.safeParse({ status: "rejected", reason: "other", note: "a".repeat(1000) }).success).toBe(true);
    const over = schema.safeParse({ status: "rejected", reason: "other", note: "a".repeat(1001) });
    expect(over.error?.issues[0].message).toBe("Note must be at most 1000 characters");
  });

  it("does not check the length of a note that is not sent: a template decline ignores the hidden text", () => {
    const hidden = schema.safeParse({ status: "rejected", reason: "position_filled", note: "a".repeat(1001) });
    expect(hidden.success).toBe(true);
    expect(hidden.data?.note).toBe("Position filled");
  });

  it("blocks a decline with no reason, an unknown reason, or Other with blank text", () => {
    for (const reason of ["", "bogus"]) {
      const result = schema.safeParse({ status: "rejected", reason, note: "typed text is not enough" });
      expect(result.error?.issues[0]).toMatchObject({ path: ["reason"], message: "Choose a reason" });
    }
    const blank = schema.safeParse({ status: "rejected", reason: "other", note: "   " });
    expect(blank.error?.issues[0]).toMatchObject({ path: ["note"], message: "Enter a reason" });
  });
});

describe("noteInputSchema", () => {
  it("trims a note and keeps it as typed text", () => {
    expect(noteInputSchema.parse({ body: "  <b>x</b>  " })).toEqual({ body: "<b>x</b>" });
  });

  it("blocks an empty or blank note", () => {
    for (const body of ["", "   ", "\n \t"]) {
      expect(noteInputSchema.safeParse({ body }).error?.issues[0].message).toBe("Enter a note");
    }
  });

  it("accepts 2000 characters and blocks 2001", () => {
    expect(noteInputSchema.safeParse({ body: "a".repeat(2000) }).success).toBe(true);
    expect(noteInputSchema.safeParse({ body: "a".repeat(2001) }).error?.issues[0].message).toBe("Note must be at most 2000 characters");
  });
});

const idList = (count: number) => Array.from({ length: count }, (_, index) => `0a1b2c3d-0000-4000-8000-${String(index).padStart(12, "0")}`);

describe("bulkActionFormSchema", () => {
  const schema = bulkActionFormSchema(1000);
  const valid = { applicationIds: idList(3), status: "interview", reason: "", note: "" };

  it("allows 1 to 100 selected applicants and refuses 0 and 101", () => {
    expect(BULK_MAX).toBe(100);
    for (const count of [1, 3, 100]) expect(schema.safeParse({ ...valid, applicationIds: idList(count) }).success).toBe(true);
    for (const count of [0, 101]) {
      const result = schema.safeParse({ ...valid, applicationIds: idList(count) });
      expect(result.error?.issues[0]).toMatchObject({ path: ["applicationIds"], message: "Select between 1 and 100 applicants" });
    }
  });

  it("refuses a decline with no template and Other with no text or blank text", () => {
    expect(schema.safeParse({ ...valid, status: "rejected" }).error?.issues[0]).toMatchObject({ path: ["reason"], message: "Choose a reason" });
    for (const note of ["", "   "]) {
      expect(schema.safeParse({ ...valid, status: "rejected", reason: "other", note }).error?.issues[0]).toMatchObject({
        path: ["note"],
        message: "Enter a reason",
      });
    }
  });

  it("accepts Other with 1000 characters and refuses 1001", () => {
    expect(schema.safeParse({ ...valid, status: "rejected", reason: "other", note: "a".repeat(1000) }).success).toBe(true);
    expect(schema.safeParse({ ...valid, status: "rejected", reason: "other", note: "a".repeat(1001) }).error?.issues[0].message).toBe(
      "Note must be at most 1000 characters",
    );
  });

  it("accepts a stage move with no note and refuses one with 1001 characters", () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, note: "a".repeat(1001) }).error?.issues[0].message).toBe("Note must be at most 1000 characters");
  });

  it("turns a template into the text the candidate reads", () => {
    expect(schema.parse({ ...valid, status: "rejected", reason: "position_filled" })).toMatchObject({ status: "rejected", note: "Position filled" });
  });

  it("refuses a stage an employer cannot choose", () => {
    for (const status of ["", "applied", "viewed", "withdrawn"]) {
      expect(schema.safeParse({ ...valid, status }).error?.issues[0].message).toBe("Choose a stage");
    }
  });
});

describe("bulkActionInputSchema", () => {
  it("takes 1 to 100 ids, a stage an employer can choose and a trimmed note, and needs a reason for a decline", () => {
    expect(bulkActionInputSchema.parse({ applicationIds: idList(100), status: "offer", note: " Week 41 " }).note).toBe("Week 41");
    expect(bulkActionInputSchema.safeParse({ applicationIds: idList(101), status: "offer", note: "" }).success).toBe(false);
    expect(bulkActionInputSchema.safeParse({ applicationIds: [], status: "offer", note: "" }).success).toBe(false);
    expect(bulkActionInputSchema.safeParse({ applicationIds: idList(1), status: "rejected", note: " " }).error?.issues[0].message).toBe("Enter a reason");
  });
});
