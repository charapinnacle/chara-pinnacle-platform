import "server-only";
import { z } from "zod";
import { parseSource } from "@/lib/env";

// Read only on the server and never inlined into the browser bundle: the secret keys the visitor hash, the hop
// count says how many reverse proxies in front of the app append to X-Forwarded-For (lib/visitor-address.ts).
const serverSchema = z.object({
  VISITOR_HASH_SECRET: z.string().min(32, "must be at least 32 characters"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10),
});

export function parseServerEnv(source: Record<string, string | undefined>) {
  return parseSource(serverSchema, source);
}

let serverValues: ReturnType<typeof parseServerEnv> | undefined;

export function serverEnv() {
  serverValues ??= parseServerEnv({
    VISITOR_HASH_SECRET: process.env.VISITOR_HASH_SECRET,
    TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
  });
  return serverValues;
}
