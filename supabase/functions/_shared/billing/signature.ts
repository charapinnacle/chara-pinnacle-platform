const encoder = new TextEncoder();

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(data));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The comparison is the one of the platform's own verify, which does not stop at the first differing byte.
export async function hmacMatches(secret: string, data: string, hex: string): Promise<boolean> {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    return false;
  }
  const mac = Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
  return await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), mac, encoder.encode(data));
}
