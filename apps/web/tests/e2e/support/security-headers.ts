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
  const nonce = /'nonce-([^']+)' 'strict-dynamic'$/.exec(csp["script-src"] ?? "")?.[1];
  expect(nonce, pathname).toBeTruthy();
  expect(csp["script-src"], pathname).not.toMatch(/unsafe-(inline|eval)/);
  expect(csp["style-src"], pathname).toBe(`'self' 'nonce-${nonce}'`);
  expect(csp["default-src"], pathname).toBe("'self'");
  expect(csp["object-src"], pathname).toBe("'none'");
  expect(csp["base-uri"], pathname).toBe("'self'");
  expect(csp["form-action"], pathname).toBe("'self'");
  expect(csp["frame-ancestors"], pathname).toBe("'none'");

  const cacheControl = (headers["cache-control"] ?? "").split(/,\s*/);
  expect(cacheControl, pathname).toEqual(expect.arrayContaining(["private", "no-store"]));
  if (isPrivatePath(pathname)) expect(headers["x-robots-tag"], pathname).toBe("noindex, nofollow");
  else expect(headers["x-robots-tag"], pathname).toBeUndefined();
}
