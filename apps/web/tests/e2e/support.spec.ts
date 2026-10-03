import { expect, test } from "@playwright/test";
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

let user: TestUser;

test.beforeEach(async () => {
  user = await createTestUser();
});

test.afterEach(async () => {
  await deleteTestUser(user.id);
});

test("the test user can sign in with the generated credentials", async ({
  request,
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
}) => {
  const recover = await request.post(`${authUrl}/recover`, {
    headers: { apikey },
    data: { email: user.email },
  });
  expect(recover.status()).toBe(200);

  const message = await waitForMessage(user.email);
  const links = extractLinks(message);

  expect(links.some((link) => link.includes("/auth/v1/verify?token="))).toBe(
    true,
  );
  expect(links.every((link) => !link.includes("&amp;"))).toBe(true);
});

test("waiting for a message that never arrives times out", async () => {
  await expect(
    waitForMessage(`nobody-${user.id}@example.test`, { timeoutMs: 600 }),
  ).rejects.toThrow("No message for");
});

test("a generated TOTP code is accepted by Auth and raises the session to aal2", async ({
  request,
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
