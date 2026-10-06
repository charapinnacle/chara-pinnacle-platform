import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { env } from "@/lib/env";
import { execute, literal, query } from "./db";
import { adminRequest, type TestUser } from "./test-user";

type Kind = "worker" | "company";

interface DocumentRow {
  slug: string;
  title: string;
  version: number;
}

export async function currentDocuments(kind: Kind): Promise<DocumentRow[]> {
  const response = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/signup_documents`,
    {
      method: "POST",
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_kind: kind }),
    },
  );
  if (!response.ok) {
    throw new Error(`signup_documents answered ${response.status}`);
  }
  return (await response.json()) as DocumentRow[];
}

export async function pendingConsents(kind: Kind) {
  return (await currentDocuments(kind)).map(({ slug, version }) => ({
    purpose: slug,
    version,
  }));
}

export interface UnconfirmedUser extends TestUser {
  confirmPath: string;
}

export async function createUnconfirmedUser(
  kind: Kind = "worker",
): Promise<UnconfirmedUser> {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const response = await adminRequest("/generate_link", {
    method: "POST",
    body: JSON.stringify({
      type: "signup",
      email,
      password,
      data: {
        intended_account_kind: kind,
        pending_consents: await pendingConsents(kind),
      },
    }),
  });
  const { id, hashed_token } = (await response.json()) as {
    id: string;
    hashed_token: string;
  };
  return {
    id,
    email,
    password,
    confirmPath: `/en/confirm-email?token_hash=${hashed_token}`,
  };
}

export async function confirmFromLink(page: Page, path: string): Promise<void> {
  await page.goto(new URL(path, "http://localhost:3100").href);
  await page.getByRole("button", { name: "Confirm email address" }).click();
}

export function moveConfirmationSent(userId: string, interval: string): void {
  execute(
    `update auth.users set confirmation_sent_at = now() - interval ${literal(interval)} where id = ${literal(userId)}`,
  );
}

export function accountRows(userId: string) {
  const [account] = query<{
    email_confirmed_at: string | null;
    raw_user_meta_data: Record<string, unknown>;
    intended_account_kind: string;
    account_kind: string | null;
    status: string;
    preferred_lang: string;
    pending_consents: { purpose: string; version: number }[];
  }>(
    `select u.email_confirmed_at, u.raw_user_meta_data, p.intended_account_kind, p.account_kind, p.status,
            p.preferred_lang, p.pending_consents
     from auth.users u join public.profiles p on p.id = u.id where u.id = ${literal(userId)}`,
  );
  const consents = query<{ purpose: string; version: number; action: string }>(
    `select purpose, version, action from public.consents where user_id = ${literal(userId)} order by id`,
  );
  const audit = query<{ action: string }>(
    `select action from audit.log where entity_id = ${literal(userId)} order by id`,
  );
  return { account, consents, audit };
}

export function userByEmail(email: string) {
  return query<{ id: string; email_confirmed_at: string | null }>(
    `select id, email_confirmed_at from auth.users where email = ${literal(email)}`,
  );
}

export function publishNewVersion(slug: string, changeSummary: string): number {
  const output = execute(
    `insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
     select slug, version + 1, title, 'Text of version ' || (version + 1), ${literal(changeSummary)}, now()
     from public.legal_documents where slug = ${literal(slug)} order by version desc limit 1
     returning version`,
  );
  return Number(output.trim());
}

export async function userToken(user: TestUser): Promise<string> {
  const response = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
  );
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}

export async function dataApiAs(
  user: TestUser,
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${await userToken(user)}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function callAs(
  user: TestUser,
  rpc: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  const response = await dataApiAs(user, `rpc/${rpc}`, { method: "POST", body: args });
  if (!response.ok) throw new Error(`${rpc} answered ${response.status}: ${await response.text()}`);
}
