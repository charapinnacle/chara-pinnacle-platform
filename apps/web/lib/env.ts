import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .startsWith("sb_publishable_", "must be a publishable key"),
  NEXT_PUBLIC_SITE_URL: httpUrl.transform((value) => new URL(value).origin),
});

export function parseSource<T extends z.ZodType>(
  validator: T,
  source: Record<string, string | undefined>,
): z.output<T> {
  const result = validator.safeParse(source);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(`Invalid environment variables: ${fields.join(", ")}`);
  }
  return result.data;
}

export function parseEnv(source: Record<string, string | undefined>) {
  return parseSource(schema, source);
}

// Next.js inlines NEXT_PUBLIC_ values only for literal property access.
export const env = parseEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

// Server-side only and read per request, never NEXT_PUBLIC: the browser tests start a second server on the same build
// with the flag on, and turning the provider on in a hosted environment needs no rebuild. Only the exact value "true"
// turns it on; any other value leaves the button off rather than breaking the password pages.
export function googleSignInEnabled(): boolean {
  return process.env.GOOGLE_SIGN_IN_ENABLED === "true";
}
