import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";
import { env } from "@/lib/env";
import type { TestUser } from "./test-user";

export async function signInBrowser(
  context: BrowserContext,
  user: TestUser,
): Promise<void> {
  const jar = new Map<string, string>();
  const client = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) =>
          cookies.forEach(({ name, value }) => jar.set(name, value)),
      },
    },
  );
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Sign-in failed: ${error.code}`);
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      domain: "localhost",
      path: "/",
    })),
  );
}
