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

function template(name: string): string {
  return readFileSync(
    path.join(import.meta.dirname, `../../../../supabase/templates/${name}`),
    "utf8",
  );
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

  it("raises the Auth limits that every visitor shares far above the per-visitor limit of 30 per five minutes", () => {
    expect(Number(value("auth.rate_limit", "sign_in_sign_ups"))).toBeGreaterThanOrEqual(3000);
    expect(Number(value("auth.rate_limit", "token_refresh"))).toBeGreaterThanOrEqual(5000);
    expect(Number(value("auth.rate_limit", "email_sent"))).toBeGreaterThanOrEqual(3000);
    expect(Number(value("auth.rate_limit", "token_verifications"))).toBeGreaterThanOrEqual(3000);
  });
});

describe("Auth configuration that FR-A3 relies on", () => {
  it("issues 30-minute access tokens, rotates refresh tokens and ends a session after 7 days", () => {
    expect(value("auth", "jwt_expiry")).toBe("1800");
    expect(value("auth", "enable_refresh_token_rotation")).toBe("true");
    expect(value("auth.sessions", "timebox")).toBe('"168h"');
  });

  it("requires a recent login to change a password", () => {
    expect(value("auth.email", "secure_password_change")).toBe("true");
  });

  it("feeds failed password checks to the database hook", () => {
    expect(value("auth.hook.password_verification_attempt", "enabled")).toBe("true");
    expect(value("auth.hook.password_verification_attempt", "uri")).toBe(
      '"pg-functions://postgres/private/hook_password_verification_attempt"',
    );
  });

  it("sends the recovery link to the reset page with the token hash and no password", () => {
    expect(value("auth.email.template.recovery", "content_path")).toBe(
      '"./supabase/templates/recovery.html"',
    );
    const recovery = template("recovery.html");
    expect(recovery).toContain("{{ .SiteURL }}/en/reset-password?token_hash={{ .TokenHash }}");
    expect(recovery).toContain("1 hour");
    expect(recovery).not.toMatch(/\{\{ \.(Password|Token) \}\}/);
  });

  it("sends a password-changed notice that carries no link to act on and no password", () => {
    expect(value("auth.email.notification.password_changed", "enabled")).toBe("true");
    expect(value("auth.email.notification.password_changed", "content_path")).toBe(
      '"./supabase/templates/password_changed.html"',
    );
    const notice = template("password_changed.html");
    expect(notice).not.toContain("token_hash");
    expect(notice).not.toMatch(/\{\{ \.(Password|Token|TokenHash|ConfirmationURL) \}\}/);
  });
});

describe("Auth configuration that Continue with Google relies on", () => {
  it("keeps the provider off for the local stack and CI, with credentials only from the environment", () => {
    expect(value("auth.external.google", "enabled")).toBe("false");
    expect(value("auth.external.google", "client_id")).toBe('"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"');
    expect(value("auth.external.google", "secret")).toBe('"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"');
    expect(section("auth.external.google")).not.toMatch(/(client_id|secret)\s*=\s*"(?!env\()[^"]+"/);
  });

  it("links a Google identity only when it signs in, never from a signed-in session", () => {
    expect(value("auth", "enable_manual_linking")).toBe("false");
  });

  it("returns from Google to the callback route of the site and to nothing else", () => {
    expect(value("auth", "additional_redirect_urls")).toBe('["http://localhost:3100/auth/callback"]');
  });

  it("tells a person who is notified of a linked sign-in method where to reset the password", () => {
    expect(value("auth.email.notification.identity_linked", "enabled")).toBe("true");
    const notice = template("identity_linked.html");
    expect(notice).toContain("{{ .Provider }}");
    expect(notice).toContain("{{ .SiteURL }}/en/forgot-password");
    expect(notice).not.toMatch(/\{\{ \.(Password|Token|TokenHash|ConfirmationURL) \}\}/);
  });

  it("words the recovery email so that it does not promise a password to a person who signs in with Google", () => {
    const recovery = template("recovery.html");
    expect(recovery).toContain("Continue with Google");
    expect(recovery).not.toMatch(/password stays as it is/i);
  });
});
