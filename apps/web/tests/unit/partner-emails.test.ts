import { describe, expect, it } from "vitest";
import { renderEmail, type NotificationKind } from "@/emails/index";

// The emails of the partner review, the licence reminders and the listing confirmation (V14, FR-T1 AC8; FR-J4 AC6;
// FR-J2 AC8; FR-K3 AC5): one primary link to the page of the context, the staff reason only where the partner needs it,
// never a fee amount, a staff member or a licence number, and never "approved" or "verified" (decision 2.6).
const SITE = "https://chara.example";
const LISTING = "11111111-1111-4111-8111-111111111111";
const LICENCE = "33333333-3333-4333-8333-333333333333";
const REASON = "Please add the countries you recruit for.";
const org = { org_name: "Manila Recruit", org_slug: "manila-recruit" };
const decision = { ...org, decision_id: 42, decided_at: "2026-11-26T09:00:00+00:00" };
const licence = { ...org, licence_id: LICENCE, country_code: "PH", country_name: "Philippines" };

// Keys a payload never has; if a producer ever put them there, the templates must still not show them.
const FORBIDDEN = {
  decided_by: "reviewer.name@staff.test",
  staff_name: "Rita Reviewer",
  licence_number: "DMW-SECRET-123",
  amount_minor: 4900,
  fee: "€49.00",
  message: "SECRET-MESSAGE-TEXT",
};

const CASES: [NotificationKind, Record<string, unknown>, string, string][] = [
  ["partner_approved", decision, "Manila Recruit is now listed on Chara Pinnacle", "/en/dashboard/employer"],
  ["partner_info_requested", { ...decision, info_step: "company", reason: REASON }, "Our team needs more information about Manila Recruit", "/en/onboarding?step=company"],
  ["partner_declined", { ...decision, reason: REASON }, "Manila Recruit was not listed", "/en/dashboard/employer"],
  ["licence_expiring", { ...licence, valid_until: "2026-12-26" }, "Your licence for Philippines expires on 26 December 2026", "/en/org/manila-recruit/workforce-profile#licences-heading"],
  ["partner_licence_expired", { ...licence, valid_until: "2026-11-25" }, "Your licence for Philippines has expired", "/en/org/manila-recruit/workforce-profile#licences-heading"],
  [
    "listing_confirmation_due",
    { ...org, total: 1, stale_days: 60, listings: [{ listing_id: LISTING, occupation: "Welders and flame cutters", country_name: "Philippines", confirmed_at: "2026-10-27T08:00:00Z" }] },
    "Confirm your availability listings",
    "/en/org/manila-recruit/workforce-profile#availability-heading",
  ],
];

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
}

describe("partner notification emails (FR-T1)", () => {
  it.each(CASES)("%s has its subject and exactly one link, the primary button to its page", async (kind, payload, subject, path) => {
    const email = await renderEmail(kind, payload, SITE);
    expect(email.subject).toBe(subject);
    expect(hrefs(email.html)).toEqual([`${SITE}${path}`]);
    expect(email.text).toContain(`${SITE}${path}`);
  });

  it.each(CASES)("%s shows no staff member, licence number, fee amount or message text, and never says approved or verified", async (kind, payload) => {
    const email = await renderEmail(kind, { ...payload, ...FORBIDDEN }, SITE);
    const all = `${email.subject}\n${email.html}\n${email.text}`;
    for (const value of Object.values(FORBIDDEN)) expect(all).not.toContain(String(value));
    expect(all).not.toMatch(/[€$£]\s?\d|\d\s?(EUR|USD)\b/);
    expect(all.toLowerCase()).not.toMatch(/\bapproved\b|\bverified\b/);
  });

  it("partner_info_requested and partner_declined quote the staff reason; partner_approved never shows one", async () => {
    for (const kind of ["partner_info_requested", "partner_declined"] as const) {
      const email = await renderEmail(kind, { ...decision, info_step: "company", reason: REASON }, SITE);
      expect(email.text, kind).toContain(REASON);
    }
    const approved = await renderEmail("partner_approved", { ...decision, reason: REASON }, SITE);
    expect(approved.text).not.toContain(REASON);
    expect(approved.html).not.toContain(REASON);
  });

  it("partner_info_requested names the reopened step and links to it, or to onboarding when the step is unknown", async () => {
    const steps = { company: "company", where_you_serve: "where-you-serve", commitments: "commitments" } as const;
    for (const [step, query] of Object.entries(steps)) {
      const email = await renderEmail("partner_info_requested", { ...decision, info_step: step, reason: REASON }, SITE);
      expect(hrefs(email.html), step).toEqual([`${SITE}/en/onboarding?step=${query}`]);
    }
    const where = await renderEmail("partner_info_requested", { ...decision, info_step: "where_you_serve" }, SITE);
    expect(where.text).toContain("needs more information about where you serve and what you offer before it can be listed.");
    const unknown = await renderEmail("partner_info_requested", { ...decision, info_step: "../../logout" }, SITE);
    expect(hrefs(unknown.html)).toEqual([`${SITE}/en/onboarding`]);
  });

  it("the licence emails name the country and the date and fall back when they are missing", async () => {
    const expiring = await renderEmail("licence_expiring", { ...licence, valid_until: "2026-12-26" }, SITE);
    expect(expiring.text).toContain("The licence Manila Recruit recorded for Philippines is valid until 26 December 2026.");
    const expired = await renderEmail("partner_licence_expired", { ...licence, valid_until: "2026-11-25" }, SITE);
    expect(expired.text).toContain("for Philippines was valid until 25 November 2026 and is now marked expired.");
    const bare = await renderEmail("licence_expiring", { valid_until: "soon" }, SITE);
    expect(bare.subject).toBe("Your licence expires soon");
    expect(hrefs(bare.html)).toEqual([]);
  });

  it("listing_confirmation_due lists each named listing, says how many more there are and when a listing is hidden", async () => {
    const listings = [
      { listing_id: LISTING, occupation: "Welders and flame cutters", country_name: "Philippines", confirmed_at: "2026-10-12T08:00:00Z" },
      { listing_id: LICENCE, occupation: "Sheet-metal workers", country_name: "Nepal", confirmed_at: "2026-10-27T08:00:00Z" },
      { occupation: "No id, not shown" },
    ];
    const email = await renderEmail("listing_confirmation_due", { ...org, total: 12, stale_days: 60, listings }, SITE);
    expect(email.text).toContain("12 availability listings of Manila Recruit were last confirmed a while ago.");
    expect(email.text).toContain("Welders and flame cutters from Philippines, last confirmed on 12 October 2026.");
    expect(email.text).toContain("Sheet-metal workers from Nepal, last confirmed on 27 October 2026.");
    expect(email.text).toContain("And 10 availability listings more.");
    expect(email.text).toContain("A listing not confirmed for 60 days is hidden from search until it is confirmed again.");
    expect(email.text).not.toContain("No id, not shown");
    expect(email.text).not.toContain(LISTING);
    const one = await renderEmail("listing_confirmation_due", { ...org, total: 1, listings: listings.slice(0, 1) }, SITE);
    expect(one.text).toContain("1 availability listing of Manila Recruit was last confirmed a while ago.");
    expect(one.text).not.toContain("more.");
  });
});
