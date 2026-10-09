import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let settings: Record<string, string> = {};
let failure: Error | null = null;
type LegalFixture = {
  title: string;
  version: number;
  body: string;
  publishedAt: string;
  changeSummary: string;
  isDraft: boolean;
  changeLog: { version: number; publishedAt: string; changeSummary: string; isDraft: boolean }[];
};

let legalDocument: LegalFixture | null = null;

const legalFixture = (over: Partial<LegalFixture> = {}): LegalFixture => ({
  title: "Privacy Policy",
  version: 3,
  body: "The legal text.",
  publishedAt: "2026-10-01T00:00:00Z",
  changeSummary: "Adds the retention periods.",
  isDraft: false,
  changeLog: [{ version: 3, publishedAt: "2026-10-01T00:00:00Z", changeSummary: "Adds the retention periods.", isDraft: false }],
  ...over,
});

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
  legalDocument = legalFixture();
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
    legalDocument = legalFixture({ title: "Terms of Service", version: 1, body: "Terms." });
    const html = renderToStaticMarkup(await LegalPage(legalProps("terms-of-service")));
    expect(html).toContain("Terms.");
    expect(html).not.toContain("Contacts for questions");
  });

  it("is not found when no version of the slug is published", async () => {
    legalDocument = null;
    await expect(LegalPage(legalProps("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the legal page (FR-H3)", () => {
  it("shows the version, the UTC date, the change summary, the headings and paragraphs of the body, and the change log newest first (AC1)", async () => {
    legalDocument = legalFixture({
      publishedAt: "2026-10-01T23:30:00Z",
      body: "## Scope\n\nFirst paragraph.\n\nSecond paragraph.",
      changeLog: [
        { version: 3, publishedAt: "2026-10-01T23:30:00Z", changeSummary: "Third change.", isDraft: false },
        { version: 2, publishedAt: "2026-09-20T00:00:00Z", changeSummary: "Second change.", isDraft: false },
        { version: 1, publishedAt: "2026-09-01T00:00:00Z", changeSummary: "Initial version", isDraft: false },
      ],
    });
    const html = renderToStaticMarkup(await LegalPage(legalProps("terms-of-service")));
    expect(html).toContain("Version 3 · Published 1 October 2026");
    expect(html).toContain("<h2");
    expect(html).toMatch(/<h2[^>]*>Scope<\/h2>/);
    expect(html).toContain(">First paragraph.</p>");
    expect(html).toContain(">Second paragraph.</p>");
    const log = html.slice(html.indexOf("Change log"));
    expect(log.indexOf("Version 3 · 1 October 2026")).toBeLessThan(log.indexOf("Version 2 · 20 September 2026"));
    expect(log.indexOf("Version 2 · 20 September 2026")).toBeLessThan(log.indexOf("Version 1 · 1 September 2026"));
    expect(log).toContain("Third change.");
    expect(log).toContain("Initial version");
  });

  it("shows the draft banner above the text of a draft and none for an approved text (AC3)", async () => {
    legalDocument = legalFixture({ isDraft: true });
    const draft = renderToStaticMarkup(await LegalPage(legalProps("terms-of-service")));
    expect(draft).toContain("Draft - not yet approved by legal counsel");
    expect(draft.indexOf("Draft - not yet approved by legal counsel")).toBeLessThan(draft.indexOf("The legal text."));

    legalDocument = legalFixture({ isDraft: false });
    expect(renderToStaticMarkup(await LegalPage(legalProps("terms-of-service")))).not.toContain("not yet approved");
  });

  it("renders markup in the text as literal text (AC12)", async () => {
    legalDocument = legalFixture({ body: "<script>window.hacked=1</script>\n\n<img src=x onerror=window.hacked=1>" });
    const html = renderToStaticMarkup(await LegalPage(legalProps("terms-of-service")));
    expect(html).toContain("&lt;script&gt;window.hacked=1&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=window.hacked=1&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
});

describe("the Trust & Safety page (FR-H1 AC12)", () => {
  it("states that paying does not verify an organisation or raise its vacancies in search", async () => {
    const text = renderToStaticMarkup(await TrustSafetyPage(trustProps)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Paying for a plan does not make an organisation verified and does not move its vacancies up in search results");
  });
});
