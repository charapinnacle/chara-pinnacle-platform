import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { InputField, TextareaField } from "@/components/forms/form-field";

type Values = { email: string; note: string };

function Harness({ error }: { error?: string }) {
  const form = useForm<Values>({ defaultValues: { email: "", note: "" } });
  if (error) form.setError("email", { type: "manual", message: error });
  return (
    <form>
      <InputField
        control={form.control}
        name="email"
        label="Email address"
        description="We never share it"
        type="email"
        autoComplete="email"
      />
      <TextareaField control={form.control} name="note" label="Note" />
    </form>
  );
}

describe("loading skeleton", () => {
  it("announces loading once and hides the placeholder blocks", () => {
    const html = renderToStaticMarkup(<LoadingSkeleton rows={4} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading</span>");
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(4);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(4);
  });
});

describe("empty state", () => {
  it("renders the title as a heading with description and action", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={Inbox} title="No vacancies" description="Post one to start.">
        <button type="button">Post a vacancy</button>
      </EmptyState>,
    );
    expect(html).toMatch(/role="heading" aria-level="2"[^>]*>No vacancies</);
    expect(html).toContain("Post one to start.");
    expect(html).toContain("Post a vacancy");
    expect(html).toContain('aria-hidden="true"');
  });

  it("omits the icon, description and action when not given", () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing yet" />);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain('data-slot="empty-description"');
    expect(html).not.toContain('data-slot="empty-content"');
  });
});

describe("form field wrappers", () => {
  it("links the label, description and control without an error", () => {
    const html = renderToStaticMarkup(<Harness />);
    const id = /<input[^>]* id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-description"`);
    expect(html).toContain('aria-invalid="false"');
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).not.toContain('role="alert"');
  });

  it("shows the error text as an alert tied to the invalid control", () => {
    const html = renderToStaticMarkup(<Harness error="Enter a valid email" />);
    const id = /<input[^>]* id="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`aria-describedby="${id}-description ${id}-error"`);
    expect(html).toMatch(new RegExp(`role="alert"[^>]*id="${id}-error"|id="${id}-error"[^>]*role="alert"`));
    expect(html).toContain("Enter a valid email");
  });

  it("wraps a textarea the same way", () => {
    const html = renderToStaticMarkup(<Harness />);
    expect(html).toMatch(/<textarea[^>]* id="[^"]+"/);
  });
});
