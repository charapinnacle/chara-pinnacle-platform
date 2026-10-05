import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  renameFormSchema,
  sanitiseFileName,
  uploadFormSchema,
  uploadSchema,
} from "@/lib/validation/documents";

const MB15 = 15_728_640;

function upload(overrides: Partial<{ type: string; title: string; expiresOn: string }> = {}, file = { name: "cv.pdf", size: 1000, type: "application/pdf" }) {
  return uploadSchema.safeParse({ type: "cv", title: "My CV", expiresOn: "", ...overrides, file });
}

function messages(result: ReturnType<typeof upload>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("the file limit", () => {
  it("is 15 MB", () => {
    expect(MAX_FILE_BYTES).toBe(MB15);
  });

  it.each([
    [0, false],
    [1, true],
    [MB15, true],
    [MB15 + 1, false],
  ])("a file of %i bytes passes: %s", (size, passes) => {
    expect(upload({}, { name: "cv.pdf", size, type: "application/pdf" }).success).toBe(passes);
  });

  it("names the size limit and the empty file", () => {
    expect(messages(upload({}, { name: "cv.pdf", size: MB15 + 1, type: "application/pdf" }))).toEqual(["file: File is larger than 15 MB"]);
    expect(messages(upload({}, { name: "cv.pdf", size: 0, type: "application/pdf" }))).toEqual(["file: The file is empty."]);
  });
});

describe("the file type", () => {
  it.each([
    ["a.pdf", "application/pdf"],
    ["a.PDF", "application/pdf"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.png", "image/png"],
    ["my.cv.final.png", "image/png"],
  ])("%s as %s passes", (name, type) => {
    expect(upload({}, { name, size: 10, type }).success).toBe(true);
  });

  it.each([
    ["a.gif", "image/gif"],
    ["a.webp", "image/webp"],
    ["a.html", "text/html"],
    ["a.zip", "application/zip"],
    ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["a.exe", "application/pdf"],
    ["a.pdf", "image/png"],
    ["a.png", "image/jpeg"],
    ["a.pdf", ""],
    ["pdf", "application/pdf"],
    ["a.pdf.exe", "application/pdf"],
  ])("%s as %s is refused with one message", (name, type) => {
    expect(messages(upload({}, { name, size: 10, type }))).toEqual(["file: Choose a PDF, JPG or PNG file."]);
  });
});

describe("the title", () => {
  it.each([
    [0, false],
    [1, true],
    [120, true],
    [121, false],
  ])("a title of %i characters passes: %s", (length, passes) => {
    expect(upload({ title: "x".repeat(length) }).success).toBe(passes);
  });

  it("is counted after trimming and stored trimmed", () => {
    expect(upload({ title: `  ${"x".repeat(120)}  ` }).success).toBe(true);
    expect(upload({ title: "   " }).success).toBe(false);
    const parsed = upload({ title: "  My CV  " });
    expect(parsed.success && parsed.data.title).toBe("My CV");
  });

  it("refuses a control character and names the problem beside the field", () => {
    expect(messages(upload({ title: "a\u0007b" }))).toEqual(["title: The title must be one line of plain text."]);
    expect(messages(upload({ title: "" }))).toEqual(["title: Enter a title."]);
    expect(messages(upload({ title: "x".repeat(121) }))).toEqual(["title: The title can have up to 120 characters."]);
  });
});

describe("the type", () => {
  it.each([
    ["cv", true],
    ["certificate", true],
    ["passport", false],
    ["CV", false],
    ["", false],
  ])("%j passes: %s", (type, passes) => {
    expect(upload({ type }).success).toBe(passes);
  });
});

describe("the expiry date", () => {
  it("belongs to a certificate and is dropped for a CV", () => {
    const certificate = upload({ type: "certificate", expiresOn: "2027-05-01" });
    expect(certificate.success && certificate.data.expiresOn).toBe("2027-05-01");
    const cv = upload({ type: "cv", expiresOn: "2027-05-01" });
    expect(cv.success && cv.data.expiresOn).toBeNull();
    const none = upload({ type: "certificate", expiresOn: "" });
    expect(none.success && none.data.expiresOn).toBeNull();
  });

  it("accepts a past date and refuses a date that is not one", () => {
    expect(upload({ type: "certificate", expiresOn: "2001-01-01" }).success).toBe(true);
    expect(messages(upload({ type: "certificate", expiresOn: "2027-02-30" }))).toEqual(["expiresOn: Choose a valid date."]);
    expect(messages(upload({ type: "certificate", expiresOn: "tomorrow" }))).toEqual(["expiresOn: Choose a valid date."]);
  });
});

describe("the form schema", () => {
  const file = new File(["%PDF-1.7"], "cv.pdf", { type: "application/pdf" });

  it("takes the chosen File and applies the same rules", () => {
    expect(uploadFormSchema.safeParse({ type: "cv", title: "My CV", expiresOn: "", file }).success).toBe(true);
    expect(uploadFormSchema.safeParse({ type: "cv", title: "My CV", expiresOn: "", file: new File(["x"], "a.gif", { type: "image/gif" }) }).success).toBe(false);
    expect(uploadFormSchema.safeParse({ type: "cv", title: "My CV", expiresOn: "", file: new File([], "cv.pdf", { type: "application/pdf" }) }).success).toBe(false);
  });

  it("asks for a file, a type and a title when nothing is chosen", () => {
    const result = uploadFormSchema.safeParse({ type: "", title: "", expiresOn: "" });
    expect(result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).sort()).toEqual([
      "file: Choose a file.",
      "title: Enter a title.",
      "type: Choose a type.",
    ]);
  });

  it("refuses a value that is not a File", () => {
    const result = uploadFormSchema.safeParse({ type: "cv", title: "t", expiresOn: "", file: { name: "cv.pdf", size: 1, type: "application/pdf" } });
    expect(result.success).toBe(false);
  });
});

describe("renameFormSchema", () => {
  it("trims and bounds the title", () => {
    expect(renameFormSchema.parse({ title: "  CV English  " })).toEqual({ title: "CV English" });
    expect(renameFormSchema.safeParse({ title: "" }).success).toBe(false);
    expect(renameFormSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
    expect(renameFormSchema.safeParse({ title: "x".repeat(120) }).success).toBe(true);
  });
});

describe("sanitiseFileName", () => {
  it("replaces every character outside A-Z, a-z, 0-9, dot, underscore and hyphen", () => {
    expect(sanitiseFileName("My CV (final).pdf")).toBe("My_CV__final_.pdf");
    expect(sanitiseFileName("naïve résumé.png")).toBe("na_ve_r_sum_.png");
  });

  it("leaves no slash in a traversal attempt", () => {
    const result = sanitiseFileName("../../etc/passwd.pdf");
    expect(result).toBe(".._.._etc_passwd.pdf");
    expect(result).not.toContain("/");
    expect(sanitiseFileName("..\\..\\win.pdf")).toBe(".._.._win.pdf");
  });

  it("cuts a long stem to 100 characters in all and keeps the extension", () => {
    const result = sanitiseFileName(`${"a".repeat(150)}.pdf`);
    expect(result).toHaveLength(100);
    expect(result.endsWith(".pdf")).toBe(true);
    expect(result).toBe(`${"a".repeat(96)}.pdf`);
    expect(sanitiseFileName(`${"b".repeat(100 - 4)}.png`)).toHaveLength(100);
  });

  it("always satisfies the constraint of the file_name column", () => {
    for (const name of ["a b.pdf", "\u0000.pdf", "日本語.png", `${"x".repeat(300)}.jpeg`, "a/b\\c.pdf"]) {
      expect(sanitiseFileName(name)).toMatch(/^[A-Za-z0-9._-]{1,100}$/);
    }
  });
});
