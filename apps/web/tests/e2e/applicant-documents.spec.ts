import { readFileSync } from "node:fs";
import { userToken } from "./support/accounts";
import { accessLog } from "./support/privacy";
import { applicantUrl, setupApplicant } from "./support/applicants";
import { execute, literal, query } from "./support/db";
import { BUCKET, seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany } from "./support/jobs";
import { logIn } from "./support/login-page";
import { jwtClaims } from "./support/login";
import { expect, test } from "./support/test";

test.describe("the documents of the applicant detail page", () => {
  test("FR-E2 AC4: the documents of the share open through a 60-second link, and every opening is logged for the candidate", async ({ page }) => {
    const { company, member, candidate, documents, applicationId } = await setupApplicant({ documents: true });
    const [cv, certificate] = documents;
    const later = await seedDocument(candidate.id, { title: "Uploaded after applying" });

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    const html = await (await page.request.get(applicantUrl(company.slug, applicationId))).text();
    expect(html).not.toContain(cv.storage_path);
    expect(html).not.toContain("token=");
    expect(html).not.toContain(BUCKET);
    const section = page.getByRole("region", { name: "Documents" });
    await expect(section.getByRole("listitem")).toHaveCount(2);
    await expect(section.getByRole("listitem").first()).toContainText("Ana CV");
    await expect(section.getByRole("listitem").first()).toContainText("CV · ana-cv.pdf · 1.2 MB");
    await expect(section.getByRole("listitem").nth(1)).toContainText("Welding certificate");
    await expect(section.getByRole("listitem").nth(1)).toContainText("Certificate · weld.pdf");
    await expect(section.getByRole("listitem").nth(1)).toContainText("Expires January 1, 2030");
    await expect(page.getByText(later.title)).toHaveCount(0);
    expect(accessLog(cv.id)).toEqual([]);

    await waitForHydration(section.getByRole("button", { name: "Open Ana CV" }));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      section.getByRole("button", { name: "Open Ana CV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("ana-cv.pdf");
    const link = new URL(download.url());
    expect(link.pathname).toBe(`/storage/v1/object/sign/${BUCKET}/${cv.storage_path}`);
    const claims = jwtClaims(link.searchParams.get("token") as string) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBe(60);
    expect(readFileSync((await download.path()) as string).subarray(0, 5).toString()).toBe("%PDF-");

    const [second] = await Promise.all([
      page.waitForEvent("download"),
      section.getByRole("button", { name: "Open Ana CV" }).click(),
    ]);
    expect(second.suggestedFilename()).toBe("ana-cv.pdf");
    const [third] = await Promise.all([
      page.waitForEvent("download"),
      section.getByRole("button", { name: "Open Welding certificate" }).click(),
    ]);
    expect(third.suggestedFilename()).toBe("weld.pdf");

    expect(accessLog(cv.id)).toEqual([
      { share_id: expect.any(String), organization_id: company.id, accessed_by: member.id, purpose: "application_review" },
    ]);
    expect(accessLog(certificate.id)).toHaveLength(1);
    expect(accessLog(later.id)).toEqual([]);
    const [entry] = query<{ worker_user_id: string }>(`select worker_user_id from audit.document_access_log where document_id = ${literal(cv.id)}`);
    expect(entry.worker_user_id).toBe(candidate.id);
  });

  test("FR-E2 AC4: a refused opening is a toast and no link, and writes no log row", async ({ page }) => {
    const { company, member, documents, applicationId } = await setupApplicant({ documents: true, pending: true });
    const [cv] = documents;

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    const section = page.getByRole("region", { name: "Documents" });
    await expect(section.getByRole("listitem").filter({ hasText: "Still scanning" })).toContainText("The file is still being checked");
    await expect(section.getByRole("button", { name: "Open Still scanning" })).toHaveCount(0);
    await waitForHydration(section.getByRole("button", { name: "Open Ana CV" }));

    execute(
      `insert into private.rate_limit_hits (action, bucket, hits, expires_at)
       values ('user:document_access', (hashtextextended(${literal(member.id)}, 0) & 2147483647) % (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_user_buckets'), 30, now() + interval '60 seconds')
       on conflict (action, bucket) do update set hits = 30, expires_at = now() + interval '60 seconds'`,
    );
    await section.getByRole("button", { name: "Open Ana CV" }).click();
    await expect(page.getByText("Too many documents were opened in a short time. Wait a minute and try again.", { exact: true })).toBeVisible();
    execute(`delete from private.rate_limit_hits where action = 'user:document_access'`);

    execute(`update public.passport_shares set revoked_at = now() where application_id = ${literal(applicationId)}`);
    await section.getByRole("button", { name: "Open Ana CV" }).click();
    await expect(page.getByText("This document is no longer available.", { exact: true })).toBeVisible();
    expect(accessLog(cv.id)).toEqual([]);

    await page.reload();
    await expect(page.getByRole("region", { name: "Documents" }).getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Documents" })).toContainText("This document is no longer available.");
  });

  test("FR-E2 AC4: a member of another organisation gets no link for the document, whatever the page", async () => {
    const { documents } = await setupApplicant({ documents: true });
    const other = await newCompany();
    const outsider = await addCompanyUser(other, "member");
    const refused = await fetch(process.env.DOCUMENT_URL_ENDPOINT as string, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await userToken(outsider)}` },
      body: JSON.stringify({ documentId: documents[0].id, purpose: "application_review" }),
    });
    expect([refused.status, await refused.json()]).toEqual([403, { error: "forbidden" }]);
    expect(accessLog(documents[0].id)).toEqual([]);
  });
});
