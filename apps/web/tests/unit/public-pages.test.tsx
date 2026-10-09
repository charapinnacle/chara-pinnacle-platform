import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let settings: Record<string, string> = {};
let failure: Error | null = null;
let legalDocument: { title: string; version: number; body: string; publishedAt: string } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/dal/settings", () => ({
  getPublicSettings: async () => {
    if (failure) throw failure;
    return settings;
  },
}));
vi.mock("@/lib/dal/legal", () => ({ getLegalDocument: async () => legalDocument }));

const { default: ImprintPage } = await import("@/app/[lang]/(public)/imprint/page");
const { default: ContactPage } = await import("@/app/[lang]/(public)/contact/page");
const { default: LegalPage } = await import("@/app/[lang]/(public)/legal/[slug]/page");
const { default: TrustSafetyPage } = await import("@/app/[lang]/(public)/trust-safety/page");

const english = { params: Promise.resolve({ lang: "en" }) };
const contactProps = english as Parameters<typeof ContactPage>[0];
const trustProps = english as Parameters<typeof TrustSafetyPage>[0];
const legalProps = (slug: string) => ({ params: Promise.resolve({ lang: "en", slug }) }) as Parameters<typeof LegalPage>[0];

beforeEach(() => {
  settings = {};
  failure = null;
  legalDocument = { title: "Privacy Policy", version: 3, body: "The legal text.", publishedAt: "2026-10-01T00:00:00Z" };
});

describe("the pages that read the settings (FR-H1 AC7, AC8)", () => {
  it("show the legal entity on the Imprint and the three contacts on the Contact page", async () => {
    settings = {
      legal_entity_name: "Example GmbH",
      legal_entity_address: "1 Example Street",
      legal_entity_registration_number: "HRB 1",
      legal_entity_vat_id: "DE1",
      legal_entity_email: "info@example.com",
      privacy_contact: "privacy@example.com",
      data_protection_contact: "dpo@example.com",
    };
    const imprint = renderToStaticMarkup(await ImprintPage());
    for (const text of ["Example GmbH", "1 Example Street", "HRB 1", "DE1", "info@example.com"]) expect(imprint).toContain(text);
    expect(imprint).not.toContain("privacy@example.com");

    const contact = renderToStaticMarkup(await ContactPage(contactProps));
    for (const text of ["info@example.com", "privacy@example.com", "dpo@example.com"]) expect(contact).toContain(text);
    expect(contact).not.toContain("Example GmbH");
  });

  it("leave out the rows of empty settings", async () => {
    const html = renderToStaticMarkup(await ImprintPage());
    expect(html).not.toContain("<dl");
    expect(html).not.toMatch(/null|undefined/);
  });

  it("throw when the settings cannot be read, so that the error page is shown", async () => {
    failure = new Error("The public settings could not be loaded");
    await expect(ImprintPage()).rejects.toThrow("could not be loaded");
    await expect(ContactPage(contactProps)).rejects.toThrow("could not be loaded");
    await expect(LegalPage(legalProps("privacy-policy"))).rejects.toThrow("could not be loaded");
  });
});

describe("the legal page (FR-H1 AC7)", () => {
  it("shows the privacy and data-protection contacts below the text of the Privacy Policy", async () => {
    settings = { privacy_contact: "privacy@example.com", data_protection_contact: "dpo@example.com", legal_entity_email: "info@example.com" };
    const html = renderToStaticMarkup(await LegalPage(legalProps("privacy-policy")));
    expect(html.indexOf("The legal text.")).toBeLessThan(html.indexOf("privacy@example.com"));
    expect(html).toContain("dpo@example.com");
    expect(html).not.toContain("info@example.com");
  });

  it("does not read the settings for another document", async () => {
    failure = new Error("not to be called");
    legalDocument = { title: "Terms of Service", version: 1, body: "Terms.", publishedAt: "2026-10-01T00:00:00Z" };
    const html = renderToStaticMarkup(await LegalPage(legalProps("terms-of-service")));
    expect(html).toContain("Terms.");
    expect(html).not.toContain("Contacts for questions");
  });

  it("is not found when no version of the slug is published", async () => {
    legalDocument = null;
    await expect(LegalPage(legalProps("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the Trust & Safety page (FR-H1 AC12)", () => {
  it("states that paying does not verify an organisation or raise its vacancies in search", async () => {
    const text = renderToStaticMarkup(await TrustSafetyPage(trustProps)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Paying for a plan does not make an organisation verified and does not move its vacancies up in search results");
  });
});
