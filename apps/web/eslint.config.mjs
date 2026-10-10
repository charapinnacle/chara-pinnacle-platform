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
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/^zod(\\/.*)?$/] > :matches(ImportSpecifier[imported.name='z'], ImportDefaultSpecifier)",
          message: 'Import * as z from "zod" (or a subpath): the z export brings all the translations of "zod" into the browser bundle.',
        },
      ],
    },
  },
]);

export default eslintConfig;
