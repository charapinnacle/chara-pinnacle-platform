import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingDetails } from "@/components/public/setting-details";
import { CONTACT_FIELDS, IMPRINT_FIELDS, PRIVACY_FIELDS, settingRows } from "@/lib/public/setting-rows";

let result: { data: unknown; error: unknown } = { data: null, error: null };
const calls: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string) => {
      calls.push(name);
      return Promise.resolve(result);
    },
  }),
}));

const { getPublicSettings } = await import("@/lib/dal/settings");

beforeEach(() => {
  calls.length = 0;
  result = { data: null, error: null };
});

describe("the rows of the Imprint and the Contact page (FR-H1 AC8)", () => {
  it("leaves out a missing key, an empty value and a value of white space: no label without a value", () => {
    const rows = settingRows({ legal_entity_name: "", legal_entity_address: "   ", legal_entity_vat_id: "\n\t " }, IMPRINT_FIELDS);
    expect(rows).toEqual([]);
    expect(settingRows({}, IMPRINT_FIELDS)).toEqual([]);
  });

  it("keeps the order of the fields and trims the value", () => {
    const rows = settingRows(
      { legal_entity_email: " info@example.com ", legal_entity_name: "Example GmbH", legal_entity_vat_id: "DE123456789" },
      IMPRINT_FIELDS,
    );
    expect(rows.map(({ label, value }) => [label, value])).toEqual([
      ["Legal entity", "Example GmbH"],
      ["VAT ID", "DE123456789"],
      ["Email", "info@example.com"],
    ]);
  });

  it("links an email address and nothing else", () => {
    const rows = settingRows(
      {
        legal_entity_email: "info@example.com",
        privacy_contact: "privacy@example.com",
        data_protection_contact: "Data Protection Officer, 1 Example Street",
      },
      CONTACT_FIELDS,
    );
    expect(rows.map(({ mailto }) => mailto)).toEqual(["mailto:info@example.com", "mailto:privacy@example.com", null]);
  });

  it.each(["info@example.com?bcc=x@example.org", "Info <info@example.com>", "a@b", "info@example.com and more", "javascript:alert(1)"])(
    "does not link %j",
    (value) => {
      expect(settingRows({ privacy_contact: value }, PRIVACY_FIELDS)[0].mailto).toBeNull();
    },
  );

  it("takes the privacy page rows from the two contacts only", () => {
    expect(PRIVACY_FIELDS.map(({ key }) => key)).toEqual(["privacy_contact", "data_protection_contact"]);
  });
});

describe("SettingDetails (FR-H1 AC8)", () => {
  it("outputs a value as escaped text and an email as a mailto link", () => {
    const rows = settingRows(
      { legal_entity_name: "<b>x</b>", legal_entity_email: "privacy@example.com", legal_entity_vat_id: " " },
      IMPRINT_FIELDS,
    );
    const html = renderToStaticMarkup(<SettingDetails rows={rows} />);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain('href="mailto:privacy@example.com"');
    expect(html).not.toContain("VAT ID");
    expect(html).not.toMatch(/null|undefined/);
  });

  it("says that the details are being completed when there is no row, with no empty list", () => {
    const html = renderToStaticMarkup(<SettingDetails rows={[]} />);
    expect(html).toContain("These details are being completed.");
    expect(html).not.toContain("<dl");
  });
});

describe("the accessor of the public settings (FR-H1 AC8)", () => {
  it("returns the values by key from the one function", async () => {
    result = { data: [{ key: "legal_entity_name", value: "Example GmbH" }, { key: "privacy_contact", value: "" }], error: null };
    await expect(getPublicSettings()).resolves.toEqual({ legal_entity_name: "Example GmbH", privacy_contact: "" });
    expect(calls).toEqual(["get_public_settings"]);
  });

  it("throws on an error, without the details of the database, instead of returning no rows", async () => {
    result = { data: null, error: { message: "secret detail" } };
    const failure = await getPublicSettings().catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("The public settings could not be loaded");
    expect((failure as Error).message).not.toContain("secret");
  });
});
