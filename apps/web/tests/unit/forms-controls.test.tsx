import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { Building2, UserRound } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { CheckboxField, CheckboxRow } from "@/components/forms/checkbox-field";
import { CheckboxGroupField } from "@/components/forms/checkbox-group-field";
import { ConsentCheckbox } from "@/components/forms/consent-checkbox";
import { ConsentSection } from "@/components/forms/consent-section";
import { PasswordField } from "@/components/forms/password-field";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { AGE_CONFIRMATION, type LegalDocumentSummary } from "@/lib/validation/consents";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/auth", () => ({ signUp: async () => undefined }));

const noop = () => undefined;

function row(props: Partial<React.ComponentProps<typeof CheckboxRow>> = {}) {
  return renderToStaticMarkup(
    <CheckboxRow id="box" name="box" checked={false} onChange={noop} onBlur={noop} invalid={false} errorId="box-error" {...props}>
      I agree
    </CheckboxRow>,
  );
}

describe("the checkbox wrapper (U67)", () => {
  it("is a native checkbox of 20 px with a 6 px radius, a 1.5 px neutral border and a near-black checked fill", () => {
    const html = row();
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*id="box"/);
    const input = /<input[^>]*>/.exec(html)![0];
    for (const rule of ["size-5", "rounded-sm", "border-[1.5px]", "border-input", "checked:bg-primary", "checked:border-primary", "duration-120"]) {
      expect(input).toContain(rule);
    }
    expect(input).not.toContain("accent");
  });

  it("has a disabled and an error state, and a white check that the assistive technology does not read", () => {
    const input = /<input[^>]*>/.exec(row())![0];
    expect(input).toContain("disabled:opacity-50");
    expect(input).toContain("aria-invalid:border-destructive");
    expect(row()).toMatch(/<svg[^>]*lucide-check[^>]*aria-hidden="true"/);
  });

  it("makes the whole row the target: the label covers it, and the row is at least 44 px high", () => {
    const html = row();
    expect(/<label[^>]*>/.exec(html)![0]).toContain("before:absolute before:inset-0");
    expect(html).toMatch(/<label[^>]*for="box"/);
    expect(html).toContain("min-h-11");
  });

  it("keeps the meta line out of the name and puts it, with the error, in the description", () => {
    const html = row({ meta: <span>Version 2</span>, invalid: true, error: { message: "Accept it" } });
    expect(html).toMatch(/<input[^>]*aria-describedby="box-meta box-error"/);
    expect(html).toMatch(/<label[^>]*>I agree<\/label>/);
    expect(html).toMatch(/<p id="box-meta"[^>]*>.*Version 2/);
    expect(html).toMatch(/<div[^>]*role="alert"[^>]*id="box-error"[^>]*>.*lucide-circle-alert.*Accept it/);
    expect(html).toContain('aria-invalid="true"');
  });

  it("describes the box by its error only while it is invalid", () => {
    expect(row({ invalid: false })).not.toContain("aria-describedby");
  });

  it("reflects the form value, one separate control for each name", () => {
    function Harness() {
      const form = useForm({ defaultValues: { terms: true, privacy: false } });
      return (
        <form>
          <CheckboxField control={form.control} name="terms" id="terms">
            Terms
          </CheckboxField>
          <CheckboxField control={form.control} name="privacy" id="privacy">
            Privacy
          </CheckboxField>
        </form>
      );
    }
    const html = renderToStaticMarkup(<Harness />);
    expect(html.match(/<input/g)).toHaveLength(2);
    expect(/<input[^>]*id="terms"[^>]*>/.exec(html)![0]).toContain('checked=""');
    expect(/<input[^>]*id="privacy"[^>]*>/.exec(html)![0]).not.toContain('checked=""');
  });

  it("is the one checkbox of a group of options too", () => {
    function Harness() {
      const form = useForm({ defaultValues: { documents: ["a"] } });
      return (
        <CheckboxGroupField
          control={form.control}
          name="documents"
          id="docs"
          legend="Documents"
          options={[
            { value: "a", label: "CV" },
            { value: "b", label: "Certificate" },
          ]}
        />
      );
    }
    const html = renderToStaticMarkup(<Harness />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain("size-5");
    expect(html).toContain("<legend");
  });
});

const document = (slug: string, title: string, version: number): LegalDocumentSummary => ({
  slug,
  title,
  version,
  publishedAt: "2026-10-04T08:00:00Z",
  changeSummary: "Changed the notice period.",
});

function consent(doc: LegalDocumentSummary, wording: string | null = null) {
  function Harness() {
    const form = useForm({ defaultValues: { accepted: { [doc.slug]: false } } });
    return (
      <ConsentCheckbox control={form.control} name={`accepted.${doc.slug}`} id={`c-${doc.slug}`} document={doc} attestationWording={wording} />
    );
  }
  return renderToStaticMarkup(<Harness />);
}

describe("the consent rows (U67, FR-A8, FR-A9)", () => {
  it("says I accept the title without DRAFT, links the title to the document and shows the version and date under it", () => {
    const html = consent(document("terms-of-service", "DRAFT: Terms of Service", 0));
    expect(html).toMatch(/I accept the(?: |&#x27;| )*<a[^>]*href="\/en\/legal\/terms-of-service"[^>]*>Terms of Service/);
    expect(html).not.toContain("DRAFT:");
    expect(html).toMatch(/<p id="c-terms-of-service-meta"[^>]*>.*Version 0 · 4 October 2026/);
  });

  it("shows no permanent underline on the title link, a thin one on hover and focus", () => {
    const link = /<a[^>]*>/.exec(consent(document("terms-of-service", "Terms of Service", 1)))![0];
    expect(link).toContain("decoration-transparent");
    expect(link).toContain("hover:decoration-foreground");
    expect(link).toContain("focus-visible:decoration-foreground");
    expect(link).toContain("relative z-10");
    expect(link).toContain('target="_blank"');
  });

  it("marks a version 0 or a DRAFT title with a neutral Draft badge, and a published document with none", () => {
    expect(consent(document("privacy-policy", "DRAFT: Privacy Policy", 0))).toMatch(/border-neutral-border[^>]*>Draft</);
    expect(consent(document("privacy-policy", "Privacy Policy", 0))).toContain(">Draft<");
    expect(consent(document("privacy-policy", "DRAFT: Privacy Policy", 3))).toContain(">Draft<");
    expect(consent(document("privacy-policy", "Privacy Policy", 3))).not.toContain(">Draft<");
  });

  it("gives every document its own checkbox with a name of its own", () => {
    const names = ["Terms of Service", "Privacy Policy", "Worker Terms"].map((title) => {
      const html = consent(document(title.toLowerCase().replaceAll(" ", "-"), `DRAFT: ${title}`, 0));
      return /I accept the(?: |&#x27;| )*<a[^>]*>([^<]*)</.exec(html)![1];
    });
    expect(new Set(names).size).toBe(3);
  });

  it("reads the age confirmation as one plain sentence until counsel's wording is published", () => {
    const draft = document("age-18-plus", "DRAFT: Age confirmation", 0);
    expect(consent(draft, "I am 18 or older. (DRAFT wording, pending review by legal counsel.)")).toMatch(
      new RegExp(`>${AGE_CONFIRMATION}</label>`),
    );
    expect(consent(draft)).not.toContain("<a ");
    expect(consent(draft)).not.toContain(">Draft<");
    expect(consent(document("age-18-plus", "Age confirmation", 2), "I confirm that I am an adult in my country.")).toContain(
      "I confirm that I am an adult in my country.",
    );
  });

  it("shows a document of its own page with its heading, what changed and the link to read it, before its checkbox", () => {
    function Harness() {
      const form = useForm({ defaultValues: { accepted: { terms: false } } });
      return <ConsentSection control={form.control} name="accepted.terms" id="consent-terms" document={document("terms", "DRAFT: Terms of Service", 0)} />;
    }
    const html = renderToStaticMarkup(<Harness />);
    expect(html).toMatch(/<h2[^>]*>Terms of Service.*Draft/);
    expect(html).toContain("Version 0 · 4 October 2026");
    expect(html).toContain("Changed the notice period.");
    expect(html).toMatch(/<a[^>]*href="\/en\/legal\/terms"[^>]*>Read the full text/);
    expect(html.indexOf("Read the full text")).toBeLessThan(html.indexOf('type="checkbox"'));
    expect(html).toMatch(/<label[^>]*>I accept the (?:<!-- -->)?Terms of Service/);
  });
});

describe("the password field (U67)", () => {
  function password(value: string, props: { checklist?: boolean } = {}) {
    function Harness() {
      const form = useForm({ defaultValues: { password: value } });
      return <PasswordField control={form.control} name="password" id="pw" label="Password" autoComplete="new-password" {...props} />;
    }
    return renderToStaticMarkup(<Harness />);
  }

  it("starts as a hidden password with a button named Show password that is not pressed", () => {
    const html = password("");
    expect(html).toMatch(/<input[^>]*type="password"/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Show password"[^>]*aria-pressed="false"/);
    expect(html).toContain('autoComplete="new-password"');
  });

  it("is 48 px high with room for the button, in the shared field style", () => {
    const input = /<input[^>]*>/.exec(password(""))![0];
    expect(input).toContain("h-12");
    expect(input).toContain("rounded-control");
    expect(input).toContain("pe-14");
  });

  it("shows a checklist of the length, not met under 12 characters and met from 12, and says so in words", () => {
    const short = password("elevenchars", { checklist: true });
    expect(short).toContain("At least 12 characters");
    expect(short).toContain(": not met yet");
    expect(short).not.toContain("lucide-check");
    const long = password("twelve chars", { checklist: true });
    expect(long).toContain(": met");
    expect(long).toContain("lucide-check");
  });

  it("describes the input by the checklist and announces a change of it politely, never on every key", () => {
    const html = password("", { checklist: true });
    expect(html).toMatch(/<input[^>]*aria-describedby="pw-checklist"/);
    expect(html).toMatch(/<div id="pw-checklist" role="status"><ul/);
    expect(html.match(/At least 12 characters/g)).toHaveLength(1);
  });

  it("has no checklist where a password is only entered", () => {
    const html = password("", { checklist: false });
    expect(html).not.toContain("checklist");
    expect(html).not.toContain("At least");
  });
});

describe("the account type choice (U67)", () => {
  function choice(value?: "worker" | "company") {
    function Harness() {
      const form = useForm<{ kind?: "worker" | "company" }>({ defaultValues: { kind: value } });
      return (
        <RadioGroupField
          control={form.control}
          name="kind"
          id="kind"
          legend="I want to register as"
          options={[
            { value: "worker", label: "I'm a worker", icon: UserRound, description: "Find work." },
            { value: "company", label: "I'm an employer", icon: Building2, description: "Hire." },
          ]}
        />
      );
    }
    return renderToStaticMarkup(<Harness />);
  }

  it("is a radiogroup of two native radios, each named by its label and described by its line", () => {
    const html = choice();
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/<input[^>]*id="kind"[^>]*aria-describedby="kind-description"/);
    expect(html).toMatch(/<label[^>]*for="kind"[^>]*>.*I(?:'|&#x27;)m a worker<\/label>/);
    expect(html).toContain("Find work.");
    expect(html).toContain("Hire.");
  });

  it("marks the chosen card with a near-black border and a check, and fills no tile", () => {
    const html = choice("company");
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain("has-checked:border-primary");
    expect(html).toContain("group-has-checked/option:bg-primary");
    expect(html).not.toContain("has-checked:bg-accent");
  });

  it("makes the two cards equal columns from the sm breakpoint and one column on a phone", () => {
    expect(choice()).toMatch(/class="grid gap-3 sm:grid-cols-2"/);
  });
});
