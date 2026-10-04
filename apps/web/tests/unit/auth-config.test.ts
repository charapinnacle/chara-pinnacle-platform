import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(
  path.join(import.meta.dirname, "../../../../supabase/config.toml"),
  "utf8",
);

function section(name: string): string {
  const start = config.indexOf(`\n[${name}]`);
  expect(start, `[${name}] is missing`).toBeGreaterThan(-1);
  const next = config.indexOf("\n[", start + 1);
  return config.slice(start, next === -1 ? undefined : next);
}

function value(sectionName: string, key: string): string | undefined {
  return new RegExp(`^${key}\\s*=\\s*(.+)$`, "m").exec(section(sectionName))?.[1].trim();
}

describe("Auth configuration that FR-A1 and FR-A8 rely on", () => {
  it("requires 12-character passwords and a confirmed email", () => {
    expect(value("auth", "minimum_password_length")).toBe("12");
    expect(value("auth.email", "enable_confirmations")).toBe("true");
    expect(value("auth", "enable_anonymous_sign_ins")).toBe("false");
  });

  it("keeps a confirmation link valid for at least 24 hours and throttles resends to one a minute", () => {
    expect(Number(value("auth.email", "otp_expiry"))).toBeGreaterThanOrEqual(86_400);
    expect(value("auth.email", "max_frequency")).toBe('"60s"');
  });

  it("sends the confirmation link to the confirm page with the token hash", () => {
    expect(value("auth.email.template.confirmation", "content_path")).toBe(
      '"./supabase/templates/confirmation.html"',
    );
    const template = readFileSync(
      path.join(import.meta.dirname, "../../../../supabase/templates/confirmation.html"),
      "utf8",
    );
    expect(template).toContain("{{ .SiteURL }}/en/confirm-email?token_hash={{ .TokenHash }}");
    expect(template).not.toMatch(/password/i);
  });

  it("limits sign-up and sign-in requests to 30 per five minutes per address", () => {
    expect(value("auth.rate_limit", "sign_in_sign_ups")).toBe("30");
  });
});
