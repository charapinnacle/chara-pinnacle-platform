import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.unmock("@/components/forms/title-text");
const { titleText } = await import("@/components/forms/title-text");

const markup = (label: string) => renderToStaticMarkup(<>{titleText(label)}</>);

describe("the Title Case of button labels", () => {
  it("keeps the short words after the first lower case, so CSS capitalize raises only the others", () => {
    expect(markup("Submit a candidate")).toBe('<span>Submit <span class="normal-case">a</span> candidate</span>');
    expect(markup("Mark as filled")).toBe('<span>Mark <span class="normal-case">as</span> filled</span>');
    expect(markup("Back to the welcome screen")).toBe(
      '<span>Back <span class="normal-case">to</span> <span class="normal-case">the</span> welcome screen</span>',
    );
  });

  it("raises a short word that starts the label and leaves labels without short words as they are", () => {
    expect(markup("A new plan")).toBe("A new plan");
    expect(markup("Save changes")).toBe("Save changes");
  });

  it("keeps the unit of a countdown lower case, and the short words of a label next to an icon or a spinner", () => {
    expect(markup("Resend in 54 s")).toBe('<span>Resend <span class="normal-case">in</span> 54 <span class="normal-case">s</span></span>');
    expect(markup("Plans s")).toBe("Plans s");
    expect(renderToStaticMarkup(<>{titleText([null, "Resend in 5 s"])}</>)).toBe(
      '<span>Resend <span class="normal-case">in</span> 5 <span class="normal-case">s</span></span>',
    );
    expect(renderToStaticMarkup(<>{titleText([<svg key="icon" />, "Submit a candidate"])}</>)).toBe(
      '<svg></svg><span>Submit <span class="normal-case">a</span> candidate</span>',
    );
  });

  it("passes anything but a plain string through", () => {
    const node = <strong>Post a job</strong>;
    expect(titleText(node)).toBe(node);
  });
});
