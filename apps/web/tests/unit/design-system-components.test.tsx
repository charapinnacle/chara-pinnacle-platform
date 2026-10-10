import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Spinner } from "@/components/feedback/spinner";
import { StatusBadge, type StatusTone } from "@/components/feedback/status-badge";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { declared } from "./support/tokens";

const html = renderToStaticMarkup;
const tones: StatusTone[] = ["success", "warning", "danger", "info", "neutral"];

describe("Card", () => {
  it("is a bordered surface on the card padding scale", () => {
    expect(html(<Card>Body</Card>)).toMatch(/<div class="[^"]*rounded-xl border bg-card[^"]*p-card[ "]/);
    expect(html(<Card padding="sm">x</Card>)).toContain("p-card-sm");
    expect(html(<Card padding="lg">x</Card>)).toContain("p-card-lg");
    expect(html(<Card padding="lg">x</Card>)).not.toContain("p-card ");
  });

  it("raises with the one shadow only when asked", () => {
    expect(html(<Card>x</Card>)).not.toContain("shadow-card");
    expect(html(<Card elevated>x</Card>)).toContain("shadow-card");
  });

  it("renders as the element asked for and keeps its attributes, so a list or a labelled region stays valid", () => {
    expect(html(<Card as="li">x</Card>)).toMatch(/^<li /);
    const section = html(<Card as="section" aria-labelledby="heading-id">x</Card>);
    expect(section).toMatch(/^<section /);
    expect(section).toContain('aria-labelledby="heading-id"');
  });

  it("lets the caller replace the gap and the layout", () => {
    const flex = html(<Card className="flex gap-1">x</Card>);
    expect(flex).toContain("flex");
    expect(flex).not.toContain("grid");
    expect(flex).toContain("gap-1");
    expect(flex).not.toContain("gap-3");
  });

  it("has header, body and footer slots", () => {
    const markup = html(
      <Card>
        <CardHeader>Header</CardHeader>
        <CardBody>Body</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(markup).toMatch(/Header<\/div><div class="grid gap-2">Body<\/div><div class="flex flex-wrap[^"]*">Footer/);
  });
});

describe("StatusBadge", () => {
  it.each(tones)("colours the %s status with its three tokens", (status) => {
    const markup = html(<StatusBadge status={status}>Label</StatusBadge>);
    expect(markup).toContain(`border-${status}-border`);
    expect(markup).toContain(`bg-${status}-background`);
    expect(markup).toContain(`text-${status}-foreground`);
    for (const part of ["foreground", "background", "border"]) {
      expect(declared("light", `${status}-${part}`)).toBeTruthy();
      expect(declared("dark", `${status}-${part}`)).toBeTruthy();
    }
  });

  it("says the status in words, so colour is never the only signal", () => {
    expect(html(<StatusBadge status="danger">Suspended</StatusBadge>)).toMatch(/>Suspended<\/span>$/);
  });

  it("is neutral without a status and takes extra classes", () => {
    const markup = html(<StatusBadge className="ms-2">Applied</StatusBadge>);
    expect(markup).toContain("bg-neutral-background");
    expect(markup).toContain("ms-2");
  });
});

describe("PageHeader", () => {
  it("renders the title as the h1 with the description under it", () => {
    const markup = html(<PageHeader title="Vacancies" description="Acme" />);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1 class="text-h1">Vacancies<\/h1><p class="text-body text-muted-foreground">Acme<\/p>/);
  });

  it("puts the breadcrumb before the title and the actions after the text", () => {
    const markup = html(
      <PageHeader title="Team" breadcrumb={<nav aria-label="Breadcrumb">Home</nav>} actions={<button type="button">Invite</button>} />,
    );
    expect(markup.indexOf("Breadcrumb")).toBeLessThan(markup.indexOf("<h1"));
    expect(markup.indexOf("</h1>")).toBeLessThan(markup.indexOf("Invite"));
    expect(markup).toContain("justify-between");
  });

  it("does not lay out a row when there are no actions", () => {
    expect(html(<PageHeader title="Team" />)).not.toContain("justify-between");
  });

  it("uses the display size for marketing pages and passes heading attributes through", () => {
    const markup = html(<PageHeader title="Home" size="display" titleProps={{ id: "page-title", tabIndex: -1, className: "wrap-anywhere" }} />);
    expect(markup).toContain("text-display");
    expect(markup).toContain('id="page-title"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("wrap-anywhere");
    expect(markup).not.toContain("text-h1");
  });

  it("renders further lines under the description", () => {
    expect(html(<PageHeader title="Settings">{<a href="/back">Back</a>}</PageHeader>)).toContain('<a href="/back">Back</a>');
  });
});

describe("LinkButton", () => {
  it("is an anchor with the accessible name of its text", () => {
    const markup = html(<LinkButton href="/en/jobs">Browse vacancies</LinkButton>);
    expect(markup).toMatch(/^<a [^>]*href="\/en\/jobs"[^>]*>Browse vacancies<\/a>$/);
  });

  it("uses the button sizes: lg is the default and matches FormButton", () => {
    expect(html(<LinkButton href="/">x</LinkButton>)).toMatch(/h-11 px-6 text-base/);
    expect(html(<LinkButton href="/" size="default">x</LinkButton>)).toMatch(/h-9 px-4/);
  });

  it("styles the primary, secondary and destructive variants and is never full width", () => {
    expect(html(<LinkButton href="/">x</LinkButton>)).toContain("hover:bg-primary-hover");
    expect(html(<LinkButton href="/" variant="secondary">x</LinkButton>)).toContain("bg-card");
    const destructive = html(<LinkButton href="/" variant="destructive">x</LinkButton>);
    expect(destructive).toContain("bg-destructive");
    expect(destructive).toContain("text-destructive-foreground");
    expect(destructive).not.toContain("w-full");
    expect(html(<LinkButton href="/">x</LinkButton>)).not.toContain("w-full");
  });

  it("lets the caller change a size", () => {
    const markup = html(<LinkButton href="/" size="default" className="min-h-11 px-3">x</LinkButton>);
    expect(markup).toContain("px-3");
    expect(markup).not.toContain("px-4");
  });
});

describe("FormButton destructive variant", () => {
  it("is a button with the destructive tokens and full width like the primary one", () => {
    const markup = html(<FormButton variant="destructive">Remove member</FormButton>);
    expect(markup).toMatch(/^<button[^>]*>Remove member<\/button>$/);
    expect(markup).toContain("bg-destructive text-destructive-foreground");
    expect(markup).toContain("hover:bg-destructive-hover");
  });

  it("shows a spinning icon and aria-busy while busy, and is disabled", () => {
    const markup = html(<FormButton variant="destructive" busy>Remove member</FormButton>);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("animate-spin");
    expect(markup).toContain("disabled:bg-destructive-active");
  });

  it("keeps the other variants unchanged", () => {
    expect(html(<FormButton>Save</FormButton>)).toContain("w-full");
    expect(html(<FormButton variant="secondary">Cancel</FormButton>)).not.toContain("bg-destructive");
  });
});

describe("Spinner", () => {
  it("is decorative, turns, and stops for people who ask for reduced motion", () => {
    const markup = html(<Spinner />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("animate-spin");
    expect(markup).toContain("motion-reduce:animate-none");
  });
});

describe("Notice tones", () => {
  it.each([
    ["success", "bg-success-background"],
    ["warning", "bg-warning-background"],
    ["error", "bg-danger-background"],
    ["info", "bg-info-background"],
  ] as const)("the %s tone uses its status tokens", (tone, background) => {
    expect(html(<Notice tone={tone}>Message</Notice>)).toContain(background);
  });

  it.each(["success", "warning", "error"] as const)("the %s tone has a hidden icon beside the text", (tone) => {
    const markup = html(<Notice tone={tone}>Message</Notice>);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Message");
  });

  it("keeps the role and the text the caller gives", () => {
    expect(html(<Notice tone="error" role="alert">Wrong password</Notice>)).toMatch(/role="alert"[^>]*>.*Wrong password/);
    expect(html(<Notice tone="info">Plain</Notice>)).not.toContain("<svg");
  });
});
