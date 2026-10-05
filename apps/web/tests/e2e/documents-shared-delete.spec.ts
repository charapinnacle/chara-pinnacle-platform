import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser } from "./support/login";
import { documentRows, openDocuments, removalJobs, row, seedDocument } from "./support/documents";
import { createEmployer, seedShare, shareAudit, shareRows } from "./support/privacy";
import { expect, test } from "./support/test";

const passportPage = (url: URL) => url.pathname === "/en/passport";
const shareReads = (url: URL) => url.pathname === "/rest/v1/passport_shares";

test.describe("candidate documents: deleting a shared document", () => {
  test("FR-B2 AC8, FR-B3: the dialog counts the applications that share the document, a confirmation revokes both shares, an unshared document has no warning", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    const shared = await seedDocument(user.id, { title: "Amina Okafor CV 2026" });
    const other = await seedDocument(user.id, { title: "Welding certificate", type: "certificate" });
    const plain = await seedDocument(user.id, { title: "Unshared CV" });
    const first = await createEmployer();
    const second = await createEmployer();
    const shareFirst = seedShare(user.id, first.organizationId, [shared.id, other.id]);
    const shareSecond = seedShare(user.id, second.organizationId, [shared.id]);
    await openDocuments(page, user);

    const dialog = page.getByRole("dialog", { name: "Delete Amina Okafor CV 2026?" });
    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await expect(dialog.getByText("This document is shared with 2 applications.", { exact: false })).toBeVisible();
    await expect(dialog).toContainText("Deleting it ends the employers' access to all documents shared in them.");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(shareRows(user.id).map((share) => share.revoked_at)).toEqual([null, null]);

    await page.route(passportPage, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await dialog.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Could not delete the document", { exact: true })).toBeVisible();
    await expect(row(page, "Amina Okafor CV 2026")).toBeVisible();
    expect(shareRows(user.id).map((share) => share.revoked_at)).toEqual([null, null]);
    expect(removalJobs(shared.storage_path)).toBe(0);
    await page.unroute(passportPage);

    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await dialog.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted", { exact: true })).toBeVisible();
    await expect(row(page, "Amina Okafor CV 2026")).toHaveCount(0);

    const shares = shareRows(user.id);
    expect(shares.map((share) => share.id)).toEqual([shareFirst, shareSecond]);
    expect(shares.every((share) => share.revoked_at !== null)).toBe(true);
    expect(shares[0].scope).toEqual([shared.id, other.id]);
    expect(documentRows(user.id).find((document) => document.id === other.id)?.deleted_at).toBeNull();
    expect([shareAudit(shareFirst), shareAudit(shareSecond)]).toEqual([
      ["share.created", "share.revoked"],
      ["share.created", "share.revoked"],
    ]);

    await page.getByRole("button", { name: "Delete Unshared CV" }).click();
    const plainDialog = page.getByRole("dialog", { name: "Delete Unshared CV?" });
    await expect(plainDialog.getByRole("button", { name: "Delete document" })).toBeEnabled();
    await expect(plainDialog).not.toContainText("shared with");
    await plainDialog.getByRole("button", { name: "Delete document" }).click();
    await expect(row(page, "Unshared CV")).toHaveCount(0);
    expect(documentRows(user.id).find((document) => document.id === plain.id)?.deleted_at).not.toBeNull();
  });

  test("FR-B3: when the shares cannot be read the dialog says so, an error toast shows and the document can still be deleted", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await seedDocument(user.id, { title: "Amina Okafor CV 2026" });
    await openDocuments(page, user);

    await page.route(shareReads, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Amina Okafor CV 2026?" });
    await expect(dialog).toContainText("We could not check whether this document is shared.");
    await expect(page.getByText("Could not check where this document is shared", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await dialog.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted", { exact: true })).toBeVisible();
    await expect(row(page, "Amina Okafor CV 2026")).toHaveCount(0);
  });
});
