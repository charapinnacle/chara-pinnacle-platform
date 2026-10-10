import { renderToStaticMarkup } from "react-dom/server";
import type { FieldErrors, UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { FormErrorSummary } from "@/components/forms/form-error-summary";

type Values = { email: string; password: string; accepted: Record<string, boolean> };

const ids = { email: "login-email", password: "login-password", "accepted.terms": "consent-terms" };
const error = (message: string) => ({ type: "manual", message });

// The summary only reads the errors of the form state and focuses a field, so the form is reduced to those two.
function render(errors: FieldErrors<Values>, setFocus = vi.fn()) {
  const form = { formState: { errors }, setFocus } as unknown as UseFormReturn<Values>;
  return renderToStaticMarkup(<FormErrorSummary form={form} ids={ids} />);
}

describe("FormErrorSummary (CODE-01)", () => {
  it("renders nothing while the form has no error", () => {
    expect(render({})).toBe("");
  });

  it("announces the problems and links each field error to its input", () => {
    const markup = render({ email: error("Enter your email."), password: error("Enter your password.") });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("There is a problem");
    expect(markup).toMatch(/href="#login-email"[^>]*>Enter your email\.</);
    expect(markup).toMatch(/href="#login-password"[^>]*>Enter your password\.</);
  });

  it("lists the fields in the order of the ids, whatever the order of the errors", () => {
    const markup = render({ password: error("Enter your password."), email: error("Enter your email.") });
    expect(markup.indexOf("Enter your email.")).toBeLessThan(markup.indexOf("Enter your password."));
  });

  it("reaches errors on nested paths such as one consent among several", () => {
    expect(render({ accepted: { terms: error("Accept the terms.") } })).toMatch(
      /href="#consent-terms"[^>]*>Accept the terms\.</,
    );
  });

  it("lists the refusal of the server after the fields, without a link", () => {
    const markup = render({ root: { server: error("Email or password is incorrect.") }, email: error("Enter your email.") });
    expect(markup.indexOf("Enter your email.")).toBeLessThan(markup.indexOf("Email or password is incorrect."));
    expect(markup).not.toMatch(/<a [^>]*>Email or password/);
  });

  it("leaves out an error of a field that is not in the ids", () => {
    expect(render({ password: error("Enter your password.") })).not.toContain("Enter your email.");
  });
});
