import { isPrivatePath } from "@/lib/seo/private-routes";
import { expect } from "./test";

export function parseCsp(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

// NFR-S5 on a page as the browser received it. Every HTML page carries a nonce that must never be served twice, so no
// page may be stored by a shared cache (ADR-0004), and the private pages are kept out of search engines as well.
export function expectSecurityHeaders(headers: Record<string, string>, pathname: string): void {
  expect(headers["strict-transport-security"], pathname).toBe("max-age=63072000; includeSubDomains; preload");
  expect(headers["x-content-type-options"], pathname).toBe("nosniff");
  expect(headers["x-frame-options"], pathname).toBe("DENY");
  expect(headers["referrer-policy"], pathname).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"], pathname).toContain("camera=()");
  expect(headers["x-powered-by"], pathname).toBeUndefined();

  const csp = parseCsp(headers["content-security-policy"] ?? "");
  expect(csp["script-src"], pathname).toMatch(/'nonce-[^']+' 'strict-dynamic'$/);
  expect(csp["script-src"], pathname).not.toMatch(/unsafe-(inline|eval)/);
  expect(csp["default-src"], pathname).toBe("'self'");
  expect(csp["object-src"], pathname).toBe("'none'");
  expect(csp["frame-ancestors"], pathname).toBe("'none'");

  const cacheControl = (headers["cache-control"] ?? "").split(/,\s*/);
  expect(cacheControl, pathname).toEqual(expect.arrayContaining(["private", "no-store"]));
  if (isPrivatePath(pathname)) expect(headers["x-robots-tag"], pathname).toBe("noindex, nofollow");
  else expect(headers["x-robots-tag"], pathname).toBeUndefined();
}
