import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["app/**", "components/**", "lib/**", "emails/**"],
    ignores: ["lib/zod.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "zod", message: 'Import * as z from "@/lib/zod": the namespace of "zod" brings all its translations into the browser bundle.' }] },
      ],
    },
  },
]);

export default eslintConfig;
