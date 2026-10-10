import { describe, expect, it } from "vitest";
import { parseLegalBody } from "@/lib/public/legal-body";

describe("parseLegalBody", () => {
  it("turns a '## ' line into a heading and a blank line into the end of a paragraph", () => {
    expect(parseLegalBody("## Scope\n\nFirst paragraph.\n\nSecond paragraph.")).toEqual([
      { kind: "heading", text: "Scope" },
      { kind: "paragraph", text: "First paragraph." },
      { kind: "paragraph", text: "Second paragraph." },
    ]);
  });

  it("keeps the lines of one paragraph together", () => {
    expect(parseLegalBody("Line one\nline two\n\nNext")).toEqual([
      { kind: "paragraph", text: "Line one\nline two" },
      { kind: "paragraph", text: "Next" },
    ]);
  });

  it("ends a paragraph at a heading without a blank line", () => {
    expect(parseLegalBody("Before\n## Next\nAfter")).toEqual([
      { kind: "paragraph", text: "Before" },
      { kind: "heading", text: "Next" },
      { kind: "paragraph", text: "After" },
    ]);
  });

  it("reads Windows and old Mac line ends and ignores extra blank lines", () => {
    expect(parseLegalBody("\r\n## A\r\n\r\n\r\nText\rmore\r\n")).toEqual([
      { kind: "heading", text: "A" },
      { kind: "paragraph", text: "Text\nmore" },
    ]);
  });

  it("treats other markers as text", () => {
    expect(parseLegalBody("# One\n### Three\n##Two\n## ")).toEqual([
      { kind: "paragraph", text: "# One\n### Three\n##Two\n##" },
    ]);
  });

  it("keeps markup as literal text", () => {
    const body = "<script>window.hacked=1</script>\n\n<img src=x onerror=window.hacked=1>";
    expect(parseLegalBody(body)).toEqual([
      { kind: "paragraph", text: "<script>window.hacked=1</script>" },
      { kind: "paragraph", text: "<img src=x onerror=window.hacked=1>" },
    ]);
  });

  it("returns nothing for an empty text", () => {
    expect(parseLegalBody("")).toEqual([]);
    expect(parseLegalBody("\n \n")).toEqual([]);
  });
});
