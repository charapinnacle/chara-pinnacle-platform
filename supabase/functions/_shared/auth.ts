// The platform checks the JWT of the request (verify_jwt = true in config.toml). A function that is called by the
// scheduler also proves it is the scheduler with a shared secret, compared without an early exit.
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

export function hasBearer(req: Request): boolean {
  return /^Bearer \S+$/.test(req.headers.get("authorization") ?? "");
}
