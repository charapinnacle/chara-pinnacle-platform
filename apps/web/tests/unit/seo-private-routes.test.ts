import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPrivatePath, privateSegments, robotsDisallow } from "@/lib/seo/private-routes";

const appDirectory = path.join(__dirname, "../../app/[lang]");

function topSegments(group: string): string[] {
  const directory = path.join(appDirectory, group);
  return readdirSync(directory).filter((entry) => statSync(path.join(directory, entry)).isDirectory());
}

describe("which paths are private (FR-H5 AC6, AC7)", () => {
  it.each([
    "/en/dashboard/worker",
    "/en/dashboard/employer",
    "/en/org/acme/jobs",
    "/en/passport",
    "/en/applications/5",
    "/en/admin/users",
    "/en/onboarding",
    "/en/login",
    "/en/signup",
    "/en/verify-email",
    "/en/forgot-password",
    "/en/mfa",
    "/en/forbidden",
    "/en/jobs/6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11/apply",
    "/auth/callback",
    "/api/health",
  ])("%s is private", (pathname) => {
    expect(isPrivatePath(pathname)).toBe(true);
  });

  it.each([
    "/en",
    "/en/jobs",
    "/en/jobs/6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
    "/en/pricing",
    "/en/how-it-works",
    "/en/trust-safety",
    "/en/about",
    "/en/contact",
    "/en/imprint",
    "/en/legal/terms-of-service",
    "/en/unknown-page",
    "/en/organizations",
    "/en/jobs/apply",
  ])("%s is public", (pathname) => {
    expect(isPrivatePath(pathname)).toBe(false);
  });

  it("lists every private page in the route groups of the app, so that a new one cannot be forgotten", () => {
    const behindLogin = [...topSegments("(app)"), ...topSegments("(auth)"), ...topSegments("(admin)")].filter(
      (segment) => segment !== "jobs",
    );
    expect(behindLogin.length).toBeGreaterThan(10);
    expect(privateSegments).toEqual(expect.arrayContaining(behindLogin));
    expect(topSegments("(app)/jobs")).toEqual(["[id]"]);
    expect(topSegments("(app)/jobs/[id]")).toEqual(["apply"]);
  });

  it("lists no segment that a public page has", () => {
    const open = topSegments("(public)");
    expect(open).toEqual(expect.arrayContaining(["jobs", "pricing", "legal", "imprint"]));
    for (const segment of open) expect(privateSegments as readonly string[], segment).not.toContain(segment);
  });

  it("asks the crawlers to stay away from each private area, including the sign-in routes without a language", () => {
    expect(robotsDisallow).toEqual(
      expect.arrayContaining([
        "/en/dashboard",
        "/en/org",
        "/en/passport",
        "/en/applications",
        "/en/admin",
        "/en/onboarding",
        "/en/login",
        "/en/signup",
        "/en/verify-email",
        "/en/forgot-password",
        "/en/mfa",
        "/auth/",
        "/api/",
        "/en/jobs/*/apply",
      ]),
    );
  });
});
