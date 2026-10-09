import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const consoleDirectory = path.join(root, "app/[lang]/(admin)");
const FORBIDDEN = [
  "document-url",
  "worker_documents",
  "passport_shares",
  "passport-documents",
  "createSignedUrl",
  "document_access_grant",
  "v_my_document_access_log",
];
// The console's own layers; the shared infrastructure beyond them (environment, clients, form primitives) has no document code of its own to find.
const LAYERS = /^@\/(lib\/(dal|actions|admin)\/|components\/admin\/|lib\/validation\/admin$)/;
const IMPORT = /(?:from|import)\s+["']((?:@\/|\.\.?\/)[^"']+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function resolve(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  return EXTENSIONS.map((extension) => base + extension).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

// The pages of the console and every module of the console's layers that they import, directly or through each other.
function reachable(): string[] {
  const seen = new Set<string>();
  const queue = sourceFiles(consoleDirectory);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const next = LAYERS.test(specifier) ? resolve(file, specifier) : undefined;
      if (next) queue.push(next);
    }
  }
  return [...seen];
}

function offences(text: string): string[] {
  return FORBIDDEN.filter((word) => text.includes(word));
}

describe("the source of the administration console", () => {
  const files = reachable().map((file) => path.relative(root, file));

  it("reaches the pages, the components, the actions and the DAL module of the console", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "app/[lang]/(admin)/admin/page.tsx",
        "app/[lang]/(admin)/admin/users/[id]/page.tsx",
        "components/admin/user-view.tsx",
        "lib/actions/admin-search.ts",
        "lib/dal/admin.ts",
      ]),
    );
    expect(files.length).toBeGreaterThan(40);
  });

  it("contains no code that opens, signs, lists or logs a document", () => {
    const found = files.flatMap((file) => offences(readFileSync(path.join(root, file), "utf8")).map((word) => `${file}: ${word}`));
    expect(found).toEqual([]);
  });

  it("is checked by a scan that finds every one of the words", () => {
    expect(offences(FORBIDDEN.join(" "))).toEqual(FORBIDDEN);
    expect(offences('await supabase.storage.from("x").createSignedUrl(path, 60)')).toEqual(["createSignedUrl"]);
  });
});
