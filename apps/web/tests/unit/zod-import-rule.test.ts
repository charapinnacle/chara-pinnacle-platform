import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../..", import.meta.url)) });

async function restricted(code: string) {
  const [result] = await eslint.lintText(code, { filePath: "lib/validation/example.ts" });
  return result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
}

describe("the Zod import rule", () => {
  it.each(['import { z } from "zod";', 'import z from "zod";'])("refuses %s in application code", async (code) => {
    expect(await restricted(code)).toHaveLength(1);
  });

  it.each(['import * as z from "zod";', 'import { object, string } from "zod";'])("accepts %s", async (code) => {
    expect(await restricted(code)).toHaveLength(0);
  });
});
