import "server-only";
import * as z from "@/lib/zod";
import { parseSource } from "@/lib/env";

// Read only on the server and never inlined into the browser bundle: the secret keys the visitor hash, the hop
// count says how many reverse proxies in front of the app append to X-Forwarded-For (lib/visitor-address.ts). The
// address of the document-url and billing-checkout functions is the project's functions address unless a deployment
// names another.
const serverSchema = z.object({
  VISITOR_HASH_SECRET: z.string().min(32, "must be at least 32 characters"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10),
  DOCUMENT_URL_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  BILLING_CHECKOUT_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
});

export function parseServerEnv(source: Record<string, string | undefined>) {
  return parseSource(serverSchema, source);
}

let serverValues: ReturnType<typeof parseServerEnv> | undefined;

export function serverEnv() {
  serverValues ??= parseServerEnv({
    VISITOR_HASH_SECRET: process.env.VISITOR_HASH_SECRET,
    TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
    DOCUMENT_URL_ENDPOINT: process.env.DOCUMENT_URL_ENDPOINT || undefined,
    BILLING_CHECKOUT_ENDPOINT: process.env.BILLING_CHECKOUT_ENDPOINT || undefined,
  });
  return serverValues;
}
