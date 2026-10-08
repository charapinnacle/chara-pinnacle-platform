import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderEmail } from "@/emails/index";

const SITE = "https://chara.example";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
const root = new URL("../../../../supabase/", import.meta.url);
const config = readFileSync(new URL("config.toml", root), "utf8");

function authTemplate(name: string): string {
  return readFileSync(new URL(`templates/${name}`, root), "utf8");
}

function configured(section: string, key: string): string | undefined {
  const start = config.indexOf(`\n[${section}]`);
  const next = config.indexOf("\n[", start + 1);
  return new RegExp(`^${key}\\s*=\\s*"(.+)"$`, "m").exec(config.slice(start, next === -1 ? undefined : next))?.[1];
}

const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// The four emails of FR-I1 AC12: sign-up confirmation and password reset (sent by Auth from supabase/templates),
// the invitation and the notice of a reset of two-step verification (sent by notify from apps/web/emails).
async function fourEmails(): Promise<Record<string, { subject: string; html: string; text: string }>> {
  const confirmation = authTemplate("confirmation.html");
  const recovery = authTemplate("recovery.html");
  return {
    confirmation: { subject: configured("auth.email.template.confirmation", "subject") ?? "", html: confirmation, text: plain(confirmation) },
    reset: { subject: configured("auth.email.template.recovery", "subject") ?? "", html: recovery, text: plain(recovery) },
    invitation: await renderEmail(
      "member_invitation",
      { org_name: "Acme Bau", role: "member", expires_at: "2026-10-15T09:30:00+00:00", token: TOKEN },
      SITE,
    ),
    "two-step reset notice": await renderEmail("mfa_reset", {}, SITE),
  };
}

describe("FR-I1 AC12: the wording of the four account emails", () => {
  it("names the platform in the subject and the body of each", async () => {
    for (const [name, email] of Object.entries(await fourEmails())) {
      expect(email.subject, name).toContain("CHARA");
      expect(email.text, name).toContain("CHARA");
    }
  });

  it("is English only: plain ASCII text that declares no other language", async () => {
    for (const [name, email] of Object.entries(await fourEmails())) {
      expect(`${email.subject}${email.text}`, name).toMatch(/^[\x20-\x7e\r\n]+$/);
      expect(email.html, name).not.toMatch(/lang="(?!en")/);
    }
  });

  it("tells the reader what to do when the email was not requested", async () => {
    const emails = await fourEmails();
    expect(emails.confirmation.text).toMatch(/If you did not create a CHARA account, you can ignore this email/);
    expect(emails.reset.text).toMatch(/If you did not ask for this email, you can ignore it as well/);
    expect(emails.invitation.text).toMatch(/If you were not expecting this invitation, ignore\s+this email/);
    expect(emails["two-step reset notice"].text).toMatch(/If you did not ask for this, reply to this\s+email or contact support at once/);
  });

  it("carries one link to the web application and none of the password or code of the person", async () => {
    for (const [name, email] of Object.entries(await fourEmails())) {
      expect(email.html.match(/href="/g), name).toHaveLength(1);
      expect(email.text, name).not.toMatch(/\b\d{6,}\b/);
    }
  });
});

describe("FR-I1: where the Auth emails come from", () => {
  it("sends the Auth emails from one named sender on the local stack, which the hosted SMTP settings replace", () => {
    expect(configured("local_smtp", "admin_email")).toBe("no-reply@chara.test");
    expect(configured("local_smtp", "sender_name")).toBe("CHARA");
  });

  it("keeps the custom SMTP out of the file, so that the local stack and CI never reach the provider", () => {
    expect(config).not.toMatch(/^\[auth\.email\.smtp\]/m);
  });
});
