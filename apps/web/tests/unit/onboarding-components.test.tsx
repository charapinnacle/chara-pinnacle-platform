import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import { OnboardingSteps } from "@/components/onboarding/onboarding-steps";
import { WelcomeTiles } from "@/components/onboarding/welcome-tiles";

const html = renderToStaticMarkup;

function items(markup: string): string[] {
  return [...markup.matchAll(/<li[^>]*>.*?<\/li>/g)].map((match) => match[0]);
}

describe("OnboardingSteps", () => {
  it("shows an employer Company, Security and Ready, with the done, current and upcoming states told apart", () => {
    const markup = html(<OnboardingSteps kind="company" current={1} />);
    expect(markup).toContain('<ol aria-label="Setting up your account"');
    const [company, security, ready] = items(markup);
    expect(company).not.toContain("aria-current");
    expect(company).toContain("Step 1 of 3: </span>Company");
    expect(company).toContain("(done)");
    expect(company).toContain("<svg");
    expect(company).toContain("bg-brand");
    expect(security).toMatch(/^<li aria-current="step"/);
    expect(security).toContain("Step 2 of 3: </span>Security");
    expect(security).toContain("font-semibold text-foreground");
    expect(security).toContain("bg-primary");
    expect(security).not.toContain("(done)");
    expect(ready).not.toContain("aria-current");
    expect(ready).toContain("Step 3 of 3: </span>Ready");
    expect(ready).toContain("border-muted-foreground/60");
    expect(ready).toContain("max-sm:sr-only");
    expect(ready).not.toContain("(done)");
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it("says which step it is in words for phones, hidden from screen readers that read the list", () => {
    expect(html(<OnboardingSteps kind="company" current={0} />)).toMatch(/<p aria-hidden="true" class="[^"]*sm:hidden[^"]*">Step 1 of 3<\/p>/);
  });

  it("shows a worker Your profile and Ready, and no step for the account or the account type", () => {
    const markup = html(<OnboardingSteps kind="worker" current={1} />);
    const labels = items(markup).map((item) => /Step \d of \d: <\/span>([^<]+)/.exec(item)?.[1]);
    expect(labels).toEqual(["Your profile", "Ready"]);
    expect(markup).not.toContain("Account type");
    expect(markup).toMatch(/<li aria-current="step"[^>]*>.*Step 2 of 2: <\/span>Ready/);
  });
});

describe("OnboardingPanel", () => {
  it("puts the steps first, then one h1 with its calm line, then the form", () => {
    const markup = html(
      <OnboardingPanel steps={<ol />} title="Tell us about your company" description="This is how candidates see you.">
        <form />
      </OnboardingPanel>,
    );
    expect(markup).toMatch(/<ol><\/ol><div class="grid gap-2"><h1[^>]*>Tell us about your company<\/h1><p[^>]*>This is how candidates see you.<\/p><\/div><form><\/form>/);
  });
});

describe("WelcomeTiles", () => {
  it("draws every next action as a link tile and only the first as the primary one", () => {
    const markup = html(
      <WelcomeTiles
        tiles={[
          { href: "/a", title: "Post your first job", text: "One" },
          { href: "/b", title: "Invite your team", text: "Two" },
        ]}
      />,
    );
    const [first, second] = items(markup);
    expect(first).toMatch(/<a [^>]*href="\/a"/);
    expect(first).toContain("bg-primary");
    expect(first).toContain("Post your first job");
    expect(second).toMatch(/<a [^>]*href="\/b"/);
    expect(second).not.toContain("bg-primary");
  });
});
