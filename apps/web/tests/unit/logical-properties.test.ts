import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(relative);
      return relative.endsWith(".tsx") || relative.endsWith(".css")
        ? [relative]
        : [];
    },
  );
}

const physicalUtility =
  /(?<=["'`\s:])-?(?:(?:ml|mr|pl|pr|left|right)-|text-(?:left|right)\b|border-[lr]\b|border-[lr]-|rounded-(?:[lr]|tl|tr|bl|br)(?:-|\b)|float-(?:left|right)\b|scroll-[mp][lr]-)/g;

describe("RTL readiness: layout uses logical properties only", () => {
  it.each([...sourceFiles("app"), ...sourceFiles("components")])(
    "%s has no physical left/right utilities",
    (file) => {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source.match(physicalUtility) ?? []).toEqual([]);
    },
  );

  it("detects a physical utility so the guard can fail", () => {
    expect('className="ml-4 text-left"'.match(physicalUtility)).toEqual([
      "ml-",
      "text-left",
    ]);
    expect('className="ms-4 text-start rounded-s-lg"'.match(physicalUtility)).toBeNull();
  });
});
