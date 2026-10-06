import { setTimeout as sleep } from "node:timers/promises";
import { env } from "@/lib/env";
import { userToken } from "./support/accounts";
import { BUCKET, seedDocument } from "./support/documents";
import { createCommittedUser, jwtClaims } from "./support/login";
import { signInAsEmployer } from "./support/organizations";
import { signIn } from "./support/passport";
import { accessLog, createEmployer, requestDocumentUrl, seedShare } from "./support/privacy";
import { expect, test } from "./support/test";

const LINK_LIFETIME_MS = 60_000;

test.describe("privacy by default", () => {
  test("FR-B3 AC11: an employer member gets a 60-second download link; the bare path, the public form and an old link are refused", async () => {
    test.setTimeout(150_000);
    const worker = await createCommittedUser("worker");
    const cv = await seedDocument(worker.id, { title: "Amina Okafor CV 2026" });
    const employer = await createEmployer();
    seedShare(worker.id, employer.organizationId, [cv.id]);

    const requestedAt = Date.now();
    const grant = await requestDocumentUrl(await userToken(employer.member), cv.id);
    expect(grant.status).toBe(200);
    expect(Object.keys(grant.body)).toEqual(["url"]);
    const link = new URL(grant.body.url as string);
    expect(link.pathname).toBe(`/storage/v1/object/sign/${BUCKET}/${cv.storage_path}`);

    const first = await fetch(link);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename=${cv.file_name};`));
    expect((await first.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const claims = jwtClaims(link.searchParams.get("token") as string) as { iat: number; exp: number; url: string };
    expect(claims.exp - claims.iat).toBe(60);
    expect(claims.url).toBe(`${BUCKET}/${cv.storage_path}`);

    const storage = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object`;
    const bare = await fetch(`${storage}/${BUCKET}/${cv.storage_path}`);
    expect([bare.status, (await bare.json()).error]).toEqual([400, "Bucket not found"]);
    const anonymous = await fetch(`${storage}/${BUCKET}/${cv.storage_path}`, {
      headers: { authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}` },
    });
    expect([anonymous.status, (await anonymous.json()).error]).toEqual([400, "Bucket not found"]);
    const publicForm = await fetch(`${storage}/public/${BUCKET}/${cv.storage_path}`);
    expect([publicForm.status, (await publicForm.json()).error]).toEqual([400, "Bucket not found"]);

    await sleep(Math.max(0, requestedAt + LINK_LIFETIME_MS + 1_000 - Date.now()));
    const expired = await fetch(link);
    expect([expired.status, (await expired.json()).message]).toEqual([400, "\"exp\" claim timestamp check failed"]);

    expect(accessLog(cv.id)).toEqual([
      { share_id: expect.any(String), organization_id: employer.organizationId, accessed_by: employer.member.id, purpose: "application_review" },
    ]);
  });

  test("FR-B3: document-url gives no link when the grant refuses, and writes no access-log row", async () => {
    const worker = await createCommittedUser("worker");
    const selected = await seedDocument(worker.id, { title: "Selected CV" });
    const unselected = await seedDocument(worker.id, { title: "Unselected CV" });
    const sharing = await createEmployer();
    const stranger = await createEmployer();
    seedShare(worker.id, sharing.organizationId, [selected.id]);

    const attempts = [
      { who: "a member of an organisation without a share", bearer: await userToken(stranger.member), id: selected.id, status: 403, error: "forbidden" },
      { who: "a member of the sharing organisation, for the unselected CV", bearer: await userToken(sharing.member), id: unselected.id, status: 403, error: "forbidden" },
      { who: "a signed-in person, for a document id that does not exist", bearer: await userToken(worker), id: "00000000-0000-0000-0000-0000000d0fff", status: 404, error: "not_found" },
      { who: "no token at all", bearer: null, id: selected.id, status: 401, error: "unauthorized" },
      { who: "the public key as a token", bearer: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, id: selected.id, status: 401, error: "unauthorized" },
    ];
    for (const { who, bearer, id, status, error } of attempts) {
      const result = await requestDocumentUrl(bearer, id);
      expect({ who, status: result.status, body: result.body }).toEqual({ who, status, body: { error } });
    }
    expect(accessLog(selected.id)).toEqual([]);
    expect(accessLog(unselected.id)).toEqual([]);
  });

  test("FR-B3 AC12: no page lists candidates, for a visitor, a candidate or an employer, and the sitemap names no candidate", async ({ page }) => {
    const notFound = async () => {
      for (const path of ["/en/find-workers", "/en/workers"]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
        await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      }
    };
    await notFound();

    await signIn(page, await createCommittedUser("worker"));
    await notFound();

    const employer = await createEmployer();
    await page.context().clearCookies();
    await signInAsEmployer(page, employer.owner);
    await notFound();

    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    const addresses = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    expect(addresses.filter((address) => /\/(find-workers|workers|passport)(\/|$)/.test(address))).toEqual([]);
  });
});
