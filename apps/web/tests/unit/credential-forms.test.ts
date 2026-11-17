import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A form submitted before hydration falls back to the browser's own submit; with the default GET the email, password
// or code would land in the address, the history and the server log.
const credentialForms = [
  "components/auth/login-form.tsx",
  "components/auth/signup-form.tsx",
  "components/auth/reset-password-form.tsx",
  "components/auth/forgot-password-form.tsx",
  "components/auth/resend-form.tsx",
  "components/mfa/code-form.tsx",
];

describe("forms that carry credentials", () => {
  it.each(credentialForms)("%s posts, so nothing it holds reaches the address", (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const forms = source.match(/<form\b[^>]*/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) expect(form).toContain('method="post"');
  });
});
