import { isObject } from "./http.ts";

const BEARER = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;

// The platform's JWT check (verify_jwt = true) is not an identity check: the scheduler sends the project's public
// anon key. The shared secret in x-edge-secret is the authentication; it is compared without an early exit.
export function hasSharedSecret(req: Request, secret: string): boolean {
  const given = req.headers.get("x-edge-secret");
  if (!secret || !given) {
    return false;
  }
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a[i] ?? 0) ^ b[i];
  }
  return diff === 0;
}

// The platform has verified the signature (verify_jwt); this only turns away, before any call, a token that cannot be
// a signed-in person's: the publishable key, an anonymous token, an expired one, and returns who the person is. What
// the person may do is the database's to say.
export function signedInUser(authorization: string): string | null {
  const payload = BEARER.exec(authorization)?.[2];
  if (!payload) {
    return null;
  }
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    return isObject(claims) && claims.role === "authenticated" &&
        typeof claims.sub === "string" &&
        typeof claims.exp === "number" && claims.exp * 1000 > Date.now()
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}
