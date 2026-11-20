import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { formatDate } from "@/lib/i18n/format";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { pdfBytes } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { addMember, enforceLimits, newTeam, newVisitor, restoreLimits, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The response pages (V46; FR-N2 AC1, AC4, AC9, AC11, AC12; FR-O2 AC1, AC4, AC5, AC8 to AC11; FR-O1 AC8, AC9; FR-J2
// AC10; NFR-U3, NFR-U4, NFR-S11): a member of an eligible partner reads the eligibility panel on the job order page,
// fills the response form by keyboard, attaches PDFs that are scanned, sends one response and reads it; the documents
// limits and a file still being checked; an edit, a stale edit, the employer's Updated badge and history, and a
// withdrawal the employer reads with its reason; Accept on an invitation opens the form and the employer's invitation
// list links the response; the employer's capacity tolerance; the panel names each missing condition; a failed
// eligibility read. Releases 2a and 2b and the plan limits are switched on for the whole database, so this file is a
// project of its own after the requirement changes, and its tests run one after the other. The job orders are in
// Liechtenstein, which no other spec uses.

const LIECHTENSTEIN = "LI";
const DOCUMENTS_BUCKET = "partner-response-documents";
const NOT_A_PARTY = "Chara Pinnacle is not a party to any agreement or payment between you and the employer";
const ELIGIBILITY_FUNCTION = "public.get_response_eligibility(uuid, uuid)";
const orderUrl = (slug: string, id: string) => `/en/org/${slug}/job-orders/${id}`;
const respondUrl = (slug: string, id: string) => `${orderUrl(slug, id)}/respond`;
const responsesUrl = (slug: string) => `/en/org/${slug}/responses`;
const responseUrl = (slug: string, id: string) => `${responsesUrl(slug)}/${id}`;
const requirementUrl = (slug: string, id: string) => `/en/org/${slug}/requirements/${id}`;
const employerResponsesUrl = (slug: string, id: string) => `${requirementUrl(slug, id)}/responses`;

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

// A listed recruitment company serving Liechtenstein with 7212, sourcing from the Philippines, on the paid Partner plan
// and with the employer-pays commitment accepted, unless asked otherwise.
async function eligiblePartner({ commitment = true, serves = true }: { commitment?: boolean; serves?: boolean } = {}): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `${serves ? `insert into public.organization_geographies (organization_id, scope, country_code) values (${literal(id)}, 'serves_market', ${literal(LIECHTENSTEIN)});` : ""}
     insert into public.organization_geographies (organization_id, scope, country_code) values (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(id)}, 'recruitment_partner', 'active', 'null');
     ${
       commitment
         ? `insert into public.consents (user_id, purpose, version, action)
            select ${literal(user.id)}, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted'
            where not private.partner_commitment_current(${literal(id)});`
         : `insert into public.consents (user_id, purpose, version, action)
            select ${literal(user.id)}, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'withdrawn';`
     }`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

// An open job order of the team in Vaduz on the marketplace without the company name: p_workers welders (7212) from 1
// March 2027, published now (the newest of the database), or a private requirement.
function seedJobOrder(team: Pick<Team, "id" | "owner">, title: string, { workers = 100, visibility = "job_order_marketplace" } = {}): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, ${workers}, ${literal(LIECHTENSTEIN)}, 'Vaduz', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', ${literal(visibility)}, false, now(), date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', ${workers});
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(LIECHTENSTEIN)})`,
  );
  return id;
}

// p_count responses of the partner this month to other job orders of the team, so that the monthly count starts there.
function seedUsedResponses(team: Pick<Team, "id" | "owner">, partner: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const requirement = seedJobOrder(team, `Earlier job order ${index + 1}`, { workers: 10 });
    execute(
      `insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, capacity, available_from,
         experience_note, fee_model)
       values (${literal(requirement)}, ${literal(partner)}, ${literal(team.id)}, 5, date '2027-01-10', 'Twenty years of welding crews', 'on_request')`,
    );
  }
}

function responseRows(requirement: string) {
  return query<{ id: string; organization_id: string; status: string; version: number; capacity: number; fee_amount: string | null }>(
    `select id, organization_id, status::text, version, capacity, fee_amount::text from public.partner_responses
     where requirement_id = ${literal(requirement)} order by created_at`,
  );
}

function documentRows(partner: string, requirement: string) {
  return query<{ id: string; storage_path: string; scan_status: string; response_id: string | null }>(
    `select id, storage_path, scan_status, response_id from public.partner_response_documents
     where organization_id = ${literal(partner)} and requirement_id = ${literal(requirement)} order by created_at, id`,
  );
}

// What the storage webhook would hand scan-document for an uploaded response document.
async function runScan(path: string): Promise<string> {
  await expect.poll(() => query(`select 1 from storage.objects where bucket_id = ${literal(DOCUMENTS_BUCKET)} and name = ${literal(path)}`).length).toBe(1);
  const [object] = query<{ id: string; metadata: Record<string, unknown> }>(
    `select id, metadata from storage.objects where bucket_id = ${literal(DOCUMENTS_BUCKET)} and name = ${literal(path)}`,
  );
  const response = await fetch(`http://127.0.0.1:${process.env.SCAN_DOCUMENT_PORT}`, {
    method: "POST",
    headers: { "x-edge-secret": process.env.EDGE_SHARED_SECRET ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      type: "INSERT",
      schema: "storage",
      table: "objects",
      record: { id: object.id, bucket_id: DOCUMENTS_BUCKET, name: path, metadata: object.metadata },
    }),
  });
  return ((await response.json()) as { status: string }).status;
}

const pdf = (name: string, size = 2 * 1024 * 1024) => ({ name, mimeType: "application/pdf", buffer: pdfBytes(size) });

function audits(action: string, entity: string): number {
  return query<{ n: number }>(`select count(*)::integer as n from audit.log where action = ${literal(action)} and entity_id = ${literal(entity)}`)[0].n;
}

function queued(userId: string, kind: string): number {
  return query<{ n: number }>(`select count(*)::integer as n from public.notifications where user_id = ${literal(userId)} and kind = ${literal(kind)}`)[0].n;
}

function panel(page: Page) {
  return page.getByRole("region", { name: "Your eligibility to respond" });
}

// The form of FR-O2 AC1, filled from the keyboard: each field is reached with Tab or focused through its label.
async function fillResponse(page: Page, { capacity = "80", amount = "1500.00" } = {}): Promise<void> {
  await page.getByLabel("Workers you can supply").focus();
  await page.keyboard.type(capacity);
  await page.getByLabel("Available from").fill("2027-01-10");
  await page.getByLabel("Timeline (optional)").focus();
  await page.keyboard.type("First 40 workers in January, the rest by March");
  await page.getByLabel("Relevant experience").focus();
  await page.keyboard.type(`${"We placed welders in the Rhine valley for ten years. ".repeat(6)}`.trim());
  await page.getByRole("radio", { name: "Fee per hire" }).focus();
  await page.keyboard.press("Space");
  await page.getByLabel("Amount").focus();
  await page.keyboard.type(amount);
  await page.getByLabel("Currency").selectOption("EUR");
  await page.getByLabel("Notes (optional)").focus();
  await page.keyboard.type("Travel and visa handling included. ".repeat(5).trim());
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(LIECHTENSTEIN)}`);
  execute(`delete from public.direct_hiring_rules where source_country = 'PH' and destination_country = ${literal(LIECHTENSTEIN)}`);
  setPartnerRelease(true);
  setJobOrderRelease(true);
  enforceLimits();
});
test.afterAll(() => {
  execute(`grant execute on function ${ELIGIBILITY_FUNCTION} to authenticated`);
  execute(`delete from public.direct_hiring_rules where source_country = 'PH' and destination_country = ${literal(LIECHTENSTEIN)}`);
  execute(`update private.settings set value = '5' where key = 'response_documents_max'`);
  restoreLimits();
  setJobOrderRelease(false);
  setPartnerRelease(false);
});

test.describe("Responding to a job order (FR-N2, FR-O2)", () => {
  test("FR-N2 AC1, FR-O2 AC1, AC10, AC11: the panel offers Respond; the form is filled by keyboard with two PDFs and sent once", async ({ page }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    seedUsedResponses(team, p1.id, 3);
    const id = seedJobOrder(team, "Vaduz welders");

    await signInAtAal1(page, p1.owner, orderUrl(p1.slug, id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(panel(page)).toContainText("You can respond: 3 of 10 responses used this month");
    await expect(page.getByText(displayName(team.id))).toHaveCount(0);
    const respond = panel(page).getByRole("link", { name: "Respond" });
    await expect(respond).toHaveAttribute("href", respondUrl(p1.slug, id));
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await respond.dblclick();
    await expect(page).toHaveURL(respondUrl(p1.slug, id));
    await expect(page.getByRole("heading", { name: "Respond to this job order", level: 1 })).toBeVisible();

    // AC10: the statement next to the fee fields, and no payment field.
    await expect(page.getByText(NOT_A_PARTY)).toBeVisible();
    await expect(page.getByLabel(/card|payment|pay through/i)).toHaveCount(0);

    // AC11: an empty submission names the errors at the fields and in the summary, and the focus goes to the first one.
    const send = page.getByRole("button", { name: "Send response" });
    await waitForHydration(send);
    await page.getByLabel("Workers you can supply").fill("0");
    await send.click();
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText("Enter a whole number of at least 1.");
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText("Describe your relevant experience");
    await expect(page.getByLabel("Workers you can supply")).toBeFocused();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByLabel("Workers you can supply").fill("");
    await fillResponse(page);
    await page.getByLabel("Add PDF files").setInputFiles([pdf("company-profile.pdf"), pdf("references.pdf")]);
    const attached = page.getByRole("list", { name: "Attached documents" });
    await expect(attached.getByText("Being checked")).toHaveCount(2);
    for (const row of documentRows(p1.id, id)) expect(await runScan(row.storage_path)).toBe("skipped");
    await expect(attached.getByText("Ready")).toHaveCount(2, { timeout: 20_000 });
    expect(documentRows(p1.id, id).every((row) => row.response_id === null)).toBe(true);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // A double click sends one response.
    await send.dblclick();
    await expect(page.getByText("Response sent", { exact: true })).toBeVisible();
    const [row] = responseRows(id);
    await expect(page).toHaveURL(responseUrl(p1.slug, row.id));
    expect(responseRows(id)).toHaveLength(1);
    expect(row).toMatchObject({ organization_id: p1.id, status: "submitted", version: 1, capacity: 80, fee_amount: "1500.00" });
    expect(documentRows(p1.id, id).every((document) => document.response_id === row.id)).toBe(true);
    expect(audits("response.created", row.id)).toBe(1);
    expect(queued(team.owner.id, "response_received")).toBe(1);

    // The read view: the status and next step, the proposal, the statement, the documents and version 1.
    await expect(page.getByText("Sent", { exact: true })).toBeVisible();
    await expect(page.getByText("The employer has your response.")).toBeVisible();
    await expect(page.getByText("EUR 1,500.00 per hire")).toBeVisible();
    await expect(page.getByText(NOT_A_PARTY)).toBeVisible();
    await expect(page.getByRole("list", { name: "Supporting documents" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Versions" }).locator("> li")).toHaveCount(1);
    await expect(page.getByText(displayName(team.id))).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The job order page now links the response; the list names it without the employer (NFR-S11).
    await page.goto(orderUrl(p1.slug, id));
    await expect(panel(page).getByRole("link", { name: "See your response" })).toHaveAttribute("href", responseUrl(p1.slug, row.id));
    await page.goto(responsesUrl(p1.slug));
    const list = page.getByRole("list", { name: "Responses" });
    await expect(list.getByRole("listitem").first()).toContainText("Company not named");
    expect(await page.content()).not.toContain(displayName(team.id));
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-O2 AC5: the sixth file, 15 MB, a renamed PNG and a file still being checked", async ({ page }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    const id = seedJobOrder(team, "Vaduz pipe fitters");

    await signInAtAal1(page, p1.owner, respondUrl(p1.slug, id));
    const files = page.getByLabel("Add PDF files");
    await waitForHydration(files);
    await expect(page.getByText("You can attach up to five documents: PDF files of up to 15 MB each.", { exact: false })).toBeVisible();

    // 15 MB is accepted, one byte more refused before any upload.
    await files.setInputFiles([pdf("too-large.pdf", 15 * 1024 * 1024 + 1)]);
    await expect(page.getByRole("alert").filter({ hasText: "too-large.pdf" })).toContainText("Choose a PDF file of up to 15 MB.");
    expect(documentRows(p1.id, id)).toHaveLength(0);
    await files.setInputFiles([pdf("exactly-15.pdf", 15 * 1024 * 1024)]);
    const attached = page.getByRole("list", { name: "Attached documents" });
    await expect(attached.getByText("exactly-15.pdf", { exact: false })).toBeVisible({ timeout: 60_000 });

    // A PNG renamed to .pdf is sent and refused by the scan's content check.
    await files.setInputFiles([{ name: "photo.pdf", mimeType: "application/pdf", buffer: Buffer.from("\x89PNG\r\n\x1a\nnot a pdf at all") }]);
    await expect.poll(() => documentRows(p1.id, id).length).toBe(2);
    expect(await runScan(documentRows(p1.id, id)[1].storage_path)).toBe("rejected");
    await expect(attached.getByText("Refused: not a valid PDF")).toBeVisible({ timeout: 20_000 });

    // Four more: the rejected file does not count, so the fifth fits and the sixth is refused.
    await files.setInputFiles([pdf("a1.pdf", 1024), pdf("a2.pdf", 1024), pdf("a3.pdf", 1024), pdf("a4.pdf", 1024), pdf("a5.pdf", 1024)]);
    await expect(page.getByRole("alert").filter({ hasText: "a5.pdf" })).toContainText("You can attach up to five documents.");
    await expect.poll(() => documentRows(p1.id, id).filter((row) => row.scan_status !== "rejected").length).toBe(5);

    // A file still being checked stops the response, and the form keeps what was entered.
    await fillResponse(page);
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(
      "A document is still being checked, try again in a minute.",
    );
    await expect(page.getByLabel("Workers you can supply")).toHaveValue("80");
    expect(responseRows(id)).toHaveLength(0);
    await expect(attached.getByRole("listitem")).toHaveCount(6);
    // No public URL: the bucket is private.
    expect(query<{ public: boolean }>(`select public from storage.buckets where id = ${literal(DOCUMENTS_BUCKET)}`)[0].public).toBe(false);
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-O2 AC8, AC9, FR-N2 AC8, AC9: change, a stale change, Updated and the history, withdrawal with a reason", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    const id = seedJobOrder(team, "Vaduz crane operators");

    await signInAtAal1(page, p1.owner, respondUrl(p1.slug, id));
    await waitForHydration(page.getByRole("button", { name: "Send response" }));
    await fillResponse(page);
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.getByText("Response sent", { exact: true })).toBeVisible();
    const [row] = responseRows(id);

    // A second tab opens the edit form before the first saves: its save is refused as stale.
    const second = await page.context().newPage();
    await second.goto(`${responseUrl(p1.slug, row.id)}/edit`);
    await page.getByRole("link", { name: "Change response" }).click();
    const save = page.getByRole("button", { name: "Save changes" });
    await waitForHydration(save);
    await page.getByLabel("Workers you can supply").fill("90");
    await page.getByLabel("Amount").fill("1400");
    await save.click();
    await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
    expect(responseRows(id)[0]).toMatchObject({ status: "updated", version: 2, capacity: 90, fee_amount: "1400.00" });
    expect(audits("response.updated", row.id)).toBe(1);
    expect(queued(team.owner.id, "response_received")).toBe(1);
    await waitForHydration(second.getByRole("button", { name: "Save changes" }));
    await second.getByLabel("Notes (optional)").fill("Changed in another tab.");
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(second.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText("Someone changed this response since you opened it.");
    await expect(second.getByRole("button", { name: "Reload the page" })).toBeVisible();
    await second.close();
    expect(responseRows(id)[0].version).toBe(2);

    // The employer: Updated until the response is opened; the history lists both versions with what changed.
    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, team.owner, team.ownerSecret, employerResponsesUrl(team.slug, id));
    const item = owner.page.getByRole("list", { name: "Responses" }).getByRole("listitem").filter({ hasText: p1.displayName });
    await expect(item.getByText("Updated", { exact: true })).toBeVisible();
    await expectAccessibleAtBothWidths(owner.page);
    await owner.page.setViewportSize({ width: 1280, height: 900 });
    await item.getByRole("link", { name: p1.displayName }).click();
    await expect(owner.page.getByRole("heading", { name: p1.displayName, level: 1 })).toBeVisible();
    const versions = owner.page.getByRole("list", { name: "Versions" }).locator("> li");
    await expect(versions).toHaveCount(2);
    await expect(versions.first()).toContainText("Version 2");
    await expect(versions.first()).toContainText("EUR 1,500.00 per hire");
    await expect(versions.first()).toContainText("EUR 1,400.00 per hire");
    await expect(versions.first()).toContainText("80 workers");
    await expect(versions.first()).toContainText("90 workers");
    await expect(owner.page.getByRole("list", { name: "Supporting documents" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(owner.page);
    await owner.page.goto(employerResponsesUrl(team.slug, id));
    await expect(item.getByText("Updated", { exact: true })).toHaveCount(0);

    // The partner withdraws with a reason; the employer reads Withdrawn, the date and the reason.
    await page.goto(responseUrl(p1.slug, row.id));
    const withdraw = page.getByRole("button", { name: "Withdraw response" });
    await waitForHydration(withdraw);
    await withdraw.click();
    const dialog = page.getByRole("dialog", { name: "Withdraw this response?" });
    await dialog.getByLabel("Reason (optional)").fill("Capacity no longer available");
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Withdraw response" }).click();
    await expect(page.getByText("Response withdrawn", { exact: true })).toBeVisible();
    await expect(page.getByText("You withdrew this response.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Change response" })).toHaveCount(0);
    expect(responseRows(id)[0].status).toBe("withdrawn");
    expect(queued(team.owner.id, "response_withdrawn")).toBe(1);
    await owner.page.reload();
    await expect(item.getByText("Withdrawn", { exact: true }).first()).toBeVisible();
    await expect(item).toContainText("Reason: Capacity no longer available");
    await owner.context.close();
  });

  test("FR-O1 AC8, AC9, FR-O2 AC4: Accept opens the form within the employer's tolerance; the invitation links the response", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    const id = seedJobOrder(team, "Private Vaduz welders", { visibility: "private" });
    const invitation = randomUUID();
    execute(
      `insert into public.requirement_invitations (id, requirement_id, organization_id, employer_organization_id, source, status)
       values (${literal(invitation)}, ${literal(id)}, ${literal(p1.id)}, ${literal(team.id)}, 'directory', 'invited')`,
    );

    // The owner allows 10 per cent more than the 100 workers needed.
    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    const tolerance = owner.page.getByLabel("Per cent above the workers needed");
    await waitForHydration(tolerance);
    await tolerance.fill("10");
    await owner.page.getByRole("button", { name: "Save tolerance" }).click();
    await expect(owner.page.getByText("Tolerance saved", { exact: true })).toBeVisible();
    await expect(owner.page.getByText("Partners can offer up to 110 workers now.")).toBeVisible();

    await signInAtAal1(page, p1.owner, `/en/org/${p1.slug}/invitations/${invitation}`);
    const accept = page.getByRole("button", { name: "Accept" });
    await waitForHydration(accept);
    await accept.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Accept this invitation?" }).getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(`/en/org/${p1.slug}/invitations/${invitation}/respond`);
    await expect(page.getByRole("heading", { name: "Respond to this invitation", level: 1 })).toBeVisible();
    await waitForHydration(page.getByRole("button", { name: "Send response" }));
    await fillResponse(page, { capacity: "111" });
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.getByText("You can offer at most 110 workers.").first()).toBeVisible();
    await page.getByLabel("Workers you can supply").fill("110");
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.getByText("Response sent", { exact: true })).toBeVisible();
    const [row] = responseRows(id);
    expect(row.capacity).toBe(110);
    expect(query<{ status: string }>(`select status::text from public.requirement_invitations where id = ${literal(invitation)}`)[0].status).toBe("responded");

    await owner.page.goto(`${requirementUrl(team.slug, id)}/invitations`);
    const invited = owner.page.getByRole("list", { name: "Invited partners" }).getByRole("listitem").filter({ hasText: p1.displayName });
    await expect(invited.getByText("Responded", { exact: true })).toBeVisible();
    await expect(invited.getByRole("link", { name: `See the response of ${p1.displayName}` })).toHaveAttribute(
      "href",
      `${employerResponsesUrl(team.slug, id)}/${row.id}`,
    );
    await owner.context.close();
  });
});

test.describe("The eligibility panel (FR-N2 AC4, AC12, FR-J2 AC10)", () => {
  test("AC4: the limit with the upgrade prompt, the commitment, the served country and the licence are named", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const id = seedJobOrder(team, "Vaduz steel fixers");

    const q1 = await eligiblePartner();
    seedUsedResponses(team, q1.id, 10);
    await signInAtAal1(page, q1.owner, orderUrl(q1.slug, id));
    await expect(panel(page)).toContainText("You have used 10 of 10 responses this month");
    await expect(panel(page).getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${q1.slug}/billing`);
    await expect(panel(page).getByRole("link", { name: "Respond" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const q2 = await eligiblePartner({ commitment: false });
    const second = await newVisitor(browser);
    await signInAtAal1(second.page, q2.owner, orderUrl(q2.slug, id));
    // V52: the panel says why, with Respond disabled, and Review and accept opens the owner's dialog.
    const reason = "Accept the employer-pays commitment so that your company can respond to job orders and submit candidates.";
    await expect(panel(second.page).getByRole("status").filter({ hasText: reason })).toBeVisible();
    await expect(panel(second.page).getByRole("button", { name: "Respond" })).toBeDisabled();
    await expect(panel(second.page).getByRole("button", { name: "Respond" })).toHaveAccessibleDescription(reason);
    await panel(second.page).getByRole("button", { name: "Review and accept" }).click();
    await expect(second.page.getByRole("dialog", { name: "Accept the employer-pays commitment" })).toBeVisible();
    await second.context.close();

    const q4 = await eligiblePartner({ serves: false });
    const fourth = await newVisitor(browser);
    await signInAtAal1(fourth.page, q4.owner, orderUrl(q4.slug, id));
    await expect(fourth.page.getByText("Add Liechtenstein to the countries you serve to see this job order.")).toBeVisible();
    await expect(fourth.page.getByRole("link", { name: "Respond" })).toHaveCount(0);
    await fourth.context.close();

    execute(
      `insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref)
       values ('PH', ${literal(LIECHTENSTEIN)}, 'licensed_partner_required', 'A licensed partner is required for this corridor.', 'E2E-V46')`,
    );
    const l3 = await eligiblePartner();
    const third = await newVisitor(browser);
    await signInAtAal1(third.page, l3.owner, orderUrl(l3.slug, id));
    await expect(panel(third.page)).toContainText("A licence for Liechtenstein is required to respond to this job order.");
    await expect(panel(third.page).getByRole("link", { name: "Add a licence" })).toHaveAttribute(
      "href",
      `/en/org/${l3.slug}/workforce-profile#licences-heading`,
    );
    await expectNoAxeViolations(third.page);
    await third.context.close();
    execute(`delete from public.direct_hiring_rules where source_country = 'PH' and destination_country = ${literal(LIECHTENSTEIN)}`);
    expect(responseRows(id)).toHaveLength(0);
  });

  test("AC12: a failed eligibility read shows a toast and a retry and no Respond; another partner's response is the 404", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    const id = seedJobOrder(team, "Vaduz riggers");
    execute(`revoke execute on function ${ELIGIBILITY_FUNCTION} from authenticated`);
    try {
      await signInAtAal1(page, p1.owner, orderUrl(p1.slug, id));
      await expect(page.getByText("Whether your company can respond could not be checked").first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Respond" })).toHaveCount(0);
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${ELIGIBILITY_FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(panel(page).getByRole("link", { name: "Respond" })).toBeVisible();

    seedUsedResponses(team, p1.id, 1);
    const [own] = query<{ id: string }>(`select id from public.partner_responses where organization_id = ${literal(p1.id)}`);
    const p2 = await eligiblePartner();
    const other = await newVisitor(browser);
    await signInAtAal1(other.page, p2.owner, responseUrl(p2.slug, own.id));
    await expect(other.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await other.page.goto(responseUrl(p2.slug, "abc"));
    await expect(other.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await other.context.close();
  });
});

// The upgrade prompt of the monthly limit (V51; FR-R1 AC10, AC11): the response refused at the limit keeps the offer and
// moves the focus to Upgrade; a member reads the usage without it; a lapsed partner is told its free plan allows none.
test.describe("The monthly limit's upgrade prompt (FR-R1 AC10, AC11)", () => {
  function firstOfNextMonth(): string {
    const now = new Date();
    return formatDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString());
  }

  function prompts(organizationId: string): number {
    return query<{ n: number }>(
      `select count(*)::integer as n from audit.log where action = 'limit.prompt_shown' and entity_id = ${literal(organizationId)}
         and metadata ->> 'limit_key' = 'job_order_responses_per_month'`,
    )[0].n;
  }

  test("AC11: the eleventh response is refused with the plan, the usage, the reset and Upgrade focused; a member sees no Upgrade", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const r = await eligiblePartner();
    const partnerTeam = { id: r.id, slug: r.slug, owner: r.owner, ownerSecret: "" };
    const admin = await addMember(partnerTeam, "admin");
    const member = await addMember(partnerTeam, "member");
    seedUsedResponses(team, r.id, 9);
    const id = seedJobOrder(team, "Vaduz limit welders");
    const [{ name: planName }] = query<{ name: string }>(`select name from billing.plans where code = 'recruitment_partner'`);

    await signInAtAal1(page, admin.user, respondUrl(r.slug, id));
    const send = page.getByRole("button", { name: "Send response" });
    await waitForHydration(send);
    await fillResponse(page);
    // The tenth response of the month is sent by someone else while the form is open.
    seedUsedResponses(team, r.id, 1);
    await send.click();

    const upgrade = page.getByRole("link", { name: "Upgrade your plan" });
    await expect(upgrade).toBeFocused();
    await expect(upgrade).toHaveAttribute("href", `/en/org/${r.slug}/billing`);
    const notice = page.getByRole("status").filter({ has: upgrade });
    await expect(notice).toContainText(`10 of 10 job order responses this month on your ${planName} plan.`);
    await expect(notice).toContainText(`The count starts again on ${firstOfNextMonth()}.`);
    expect(responseRows(id)).toHaveLength(0);
    await expect(page.getByLabel("Workers you can supply")).toHaveValue("80");
    await expect(page.getByLabel("Amount")).toHaveValue("1500.00");
    await expect.poll(() => prompts(r.id)).toBeGreaterThan(0);
    await expectAccessibleAtBothWidths(page);

    const other = await newVisitor(browser);
    await signInAtAal1(other.page, member.user, orderUrl(r.slug, id));
    await expect(panel(other.page)).toContainText(`10 of 10 job order responses this month on your ${planName} plan.`);
    await expect(panel(other.page)).toContainText(`The count starts again on ${firstOfNextMonth()}.`);
    await expect(panel(other.page).getByRole("link", { name: "Upgrade your plan" })).toHaveCount(0);
    await expect(panel(other.page).getByRole("link", { name: "Respond" })).toHaveCount(0);
    await expectNoAxeViolations(other.page);
    await other.context.close();
  });

  test("AC10: an invited partner whose plan lapsed is told its free plan allows no responses, without a reset date", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const l = await eligiblePartner();
    const id = seedJobOrder(team, "Private Vaduz riggers", { visibility: "private" });
    const invitation = randomUUID();
    execute(
      `insert into public.requirement_invitations (id, requirement_id, organization_id, employer_organization_id, source, status, viewed_at)
       values (${literal(invitation)}, ${literal(id)}, ${literal(l.id)}, ${literal(team.id)}, 'directory', 'viewed', now());
       update billing.subscriptions set status = 'canceled' where organization_id = ${literal(l.id)}`,
    );
    const [{ name: planName }] = query<{ name: string }>(`select name from billing.plans where code = 'free_recruitment_company'`);

    await signInAtAal1(page, l.owner, `/en/org/${l.slug}/invitations/${invitation}/respond`);
    await expect(panel(page)).toContainText(`0 of 0 job order responses this month on your ${planName} plan.`);
    await expect(panel(page)).not.toContainText("The count starts again");
    await expect(panel(page).getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${l.slug}/billing`);
    await expect(page.getByRole("button", { name: "Send response" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    expect(responseRows(id)).toHaveLength(0);
  });
});
