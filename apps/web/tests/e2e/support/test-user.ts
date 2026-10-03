import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

function adminKey(): string {
  const key = process.env.E2E_AUTH_ADMIN_KEY;
  if (!key) {
    throw new Error("E2E_AUTH_ADMIN_KEY is not set");
  }
  return key;
}

async function adminRequest(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin${path}`,
    {
      ...init,
      headers: { apikey: adminKey(), "content-type": "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Auth admin ${path} answered ${response.status}`);
  }
  return response;
}

export async function createTestUser(): Promise<TestUser> {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const response = await adminRequest("/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const { id } = (await response.json()) as { id: string };
  return { id, email, password };
}

export async function deleteTestUser(id: string): Promise<void> {
  await adminRequest(`/users/${id}`, { method: "DELETE" });
}
