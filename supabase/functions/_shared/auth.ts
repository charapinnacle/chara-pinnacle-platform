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
