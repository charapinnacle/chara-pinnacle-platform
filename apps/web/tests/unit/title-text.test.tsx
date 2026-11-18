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

  it("passes anything but a plain string through", () => {
    const node = <strong>Post a job</strong>;
    expect(titleText(node)).toBe(node);
  });
});
