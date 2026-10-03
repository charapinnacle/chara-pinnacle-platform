type CspOptions = {
  nonce: string;
  supabaseUrl: string;
  isDev: boolean;
  upgradeInsecureRequests: boolean;
};

export function buildCsp({
  nonce,
  supabaseUrl,
  isDev,
  upgradeInsecureRequests,
}: CspOptions): string {
  const supabase = new URL(supabaseUrl);
  const realtimeProtocol = supabase.protocol === "https:" ? "wss:" : "ws:";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data: ${supabase.origin}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase.origin} ${realtimeProtocol}//${supabase.host}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecureRequests) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
