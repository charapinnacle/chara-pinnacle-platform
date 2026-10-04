import { expect, test as base } from "@playwright/test";
import { env } from "@/lib/env";
import { extractLinks, waitForMessage } from "./support/mailpit";
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./support/test-user";
import { totpCode } from "./support/totp";

const authUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const apikey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const test = base.extend<{ user: TestUser }>({
  user: async ({}, provide) => {
    const created = await createTestUser();
    try {
      await provide(created);
    } finally {
      await deleteTestUser(created.id);
    }
  },
});

test("the test user can sign in with the generated credentials", async ({
  request,
  user,
}) => {
  const bad = await request.post(`${authUrl}/token?grant_type=password`, {
    headers: { apikey },
    data: { email: user.email, password: `${user.password}x` },
  });
  expect(bad.status()).toBe(400);

  const good = await request.post(`${authUrl}/token?grant_type=password`, {
    headers: { apikey },
    data: { email: user.email, password: user.password },
  });
  expect(good.status()).toBe(200);
  expect((await good.json()).user.id).toBe(user.id);
});

test("an auth email reaches Mailpit and its link is extracted", async ({
  request,
  user,
}) => {
  const recover = await request.post(`${authUrl}/recover`, {
    headers: { apikey },
    data: { email: user.email },
  });
  expect(recover.status()).toBe(200);

  const message = await waitForMessage(user.email);
  const links = extractLinks(message);

  expect(links.some((link) => link.includes("/en/reset-password?token_hash="))).toBe(
    true,
  );
  expect(links.every((link) => !link.includes("&amp;"))).toBe(true);
});

test("waiting for a message that never arrives times out", async ({ user }) => {
  await expect(
    waitForMessage(`nobody-${user.id}@example.test`, { timeoutMs: 600 }),
  ).rejects.toThrow("No message for");
});

test("a subject filter skips earlier mail and trailing punctuation is trimmed", async ({
  request,
  user,
}) => {
  const send = (subject: string, text: string) =>
    request.post("http://127.0.0.1:54424/api/v1/send", {
      data: {
        From: { Email: "noreply@example.test" },
        To: [{ Email: user.email }],
        Subject: subject,
        Text: text,
      },
    });
  expect((await send("First", "see https://example.test/first.")).ok()).toBe(
    true,
  );
  expect(
    (await send("Second", "open (https://example.test/second?a=1&b=2),")).ok(),
  ).toBe(true);

  const first = await waitForMessage(user.email, { subject: "First" });
  expect(first.Subject).toBe("First");
  expect(extractLinks(first)).toEqual(["https://example.test/first"]);

  const second = await waitForMessage(user.email, { subject: "Second" });
  expect(extractLinks(second)).toEqual(["https://example.test/second?a=1&b=2"]);
});

test("a generated TOTP code is accepted by Auth and raises the session to aal2", async ({
  request,
  user,
}) => {
  const session = await (
    await request.post(`${authUrl}/token?grant_type=password`, {
      headers: { apikey },
      data: { email: user.email, password: user.password },
    })
  ).json();
  const headers = { apikey, authorization: `Bearer ${session.access_token}` };

  const factor = await (
    await request.post(`${authUrl}/factors`, {
      headers,
      data: { factor_type: "totp", friendly_name: "e2e" },
    })
  ).json();
  const challenge = await (
    await request.post(`${authUrl}/factors/${factor.id}/challenge`, {
      headers,
    })
  ).json();

  const wrong = await request.post(`${authUrl}/factors/${factor.id}/verify`, {
    headers,
    data: { challenge_id: challenge.id, code: "000000" },
  });
  expect(wrong.status()).toBe(422);

  const verified = await request.post(
    `${authUrl}/factors/${factor.id}/verify`,
    {
      headers,
      data: {
        challenge_id: challenge.id,
        code: totpCode(factor.totp.secret),
      },
    },
  );
  expect(verified.status()).toBe(200);
  const claims = JSON.parse(
    Buffer.from(
      (await verified.json()).access_token.split(".")[1],
      "base64url",
    ).toString(),
  );
  expect(claims.aal).toBe("aal2");
});
