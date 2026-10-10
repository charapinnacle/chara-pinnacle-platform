import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/global-error";
import AppError from "@/app/[lang]/(app)/error";
import AuthError from "@/app/[lang]/(auth)/error";

describe("the error boundaries of the signed-in area, the sign-in area and the whole app", () => {
  const error = Object.assign(new Error("relation secret_table detail"), { digest: "d9" });

  it.each([
    ["the signed-in area", <AppError key="app" error={error} retry={vi.fn()} />],
    ["the sign-in area", <AuthError key="auth" error={error} retry={vi.fn()} />],
    ["the whole app", <GlobalError key="global" error={error} retry={vi.fn()} />],
  ])("show %s a message, a retry button and a link home, and leak nothing of the error", (_name, element) => {
    const html = renderToStaticMarkup(element);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[^<]*Try again/);
    expect(html).toMatch(/<a [^>]*href="\/en"[^>]*>Go to the home page<\/a>/);
    expect(html).not.toContain("secret_table");
    expect(html).not.toContain("d9");
  });

  it("brings its own document with a language and a title for the global one", () => {
    const html = renderToStaticMarkup(<GlobalError error={error} retry={vi.fn()} />);
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("<title>Something went wrong");
  });
});
