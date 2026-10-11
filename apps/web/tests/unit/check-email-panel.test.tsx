import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";

vi.mock("server-only", () => ({}));

const render = (initialCooldown: number) =>
  renderToStaticMarkup(
    <CheckEmailPanel
      maskedEmail="a*****6@gmail.com"
      initialCooldown={initialCooldown}
      resend={async () => ({ cooldown: 60, sent: true })}
      differentAddressHref="/en/signup"
    />,
  );

describe("CheckEmailPanel (U67)", () => {
  it("shows the masked address, a Resend button without any input, the spam hint and the way back to the form", () => {
    const html = render(0);
    expect(html).toContain("a*****6@gmail.com");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Resend email<\/button>/);
    expect(html).not.toContain("<input");
    expect(html).toContain("Not there? Check your spam or promotions folder.");
    expect(html).toMatch(/<a[^>]*href="\/en\/signup"[^>]*>Use a different address<\/a>/);
  });

  it("shows the cooldown on the button and keeps the button focusable for the keyboard (aria-disabled, never disabled)", () => {
    const html = render(42);
    const button = /<button[^>]*>/.exec(html)![0];
    expect(html).toContain("Resend in 42 s</button>");
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("is a plain, enabled button once the cooldown is over", () => {
    const button = /<button[^>]*>/.exec(render(0))![0];
    expect(button).not.toContain("aria-disabled");
    expect(button).not.toContain("aria-busy");
  });

  it("keeps a polite live region in the page from the start, so that the result of a resend is announced", () => {
    expect(render(0)).toMatch(/<div role="status" aria-live="polite" class="sr-only"><\/div>/);
  });
});
