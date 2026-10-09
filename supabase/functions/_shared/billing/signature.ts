const encoder = new TextEncoder();

// The comparison is the one of the platform's own verify, which does not stop at the first differing byte.
export async function hmacMatches(secret: string, data: string, hex: string): Promise<boolean> {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    return false;
  }
  const mac = Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "verify",
  ]);
  return await crypto.subtle.verify("HMAC", key, mac, encoder.encode(data));
}
