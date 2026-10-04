import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .startsWith("sb_publishable_", "must be a publishable key"),
  NEXT_PUBLIC_SITE_URL: httpUrl.transform((value) => new URL(value).origin),
});

// Read only on the server and never inlined into the browser bundle: the secret keys the visitor hash, the hop
// count says how many reverse proxies in front of the app append to X-Forwarded-For (lib/visitor-address.ts).
const serverSchema = z.object({
  VISITOR_HASH_SECRET: z.string().min(32, "must be at least 32 characters"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10),
});

function parse<T extends z.ZodType>(
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
  return parse(schema, source);
}

export function parseServerEnv(source: Record<string, string | undefined>) {
  return parse(serverSchema, source);
}

// Next.js inlines NEXT_PUBLIC_ values only for literal property access.
export const env = parseEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

let serverValues: ReturnType<typeof parseServerEnv> | undefined;

export function serverEnv() {
  serverValues ??= parseServerEnv({
    VISITOR_HASH_SECRET: process.env.VISITOR_HASH_SECRET,
    TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
  });
  return serverValues;
}
