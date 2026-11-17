import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AcceptConfirmation, InvitationAnswer } from "@/components/invitations/invitation-answer";

const answerInvitation = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/invitations", () => ({ answerInvitation }));

const props = {
  slug: "baltic-crew",
  invitationId: "00000000-0000-4000-8000-000000000001",
  employerName: "Acme Bau",
  respondHref: "/en/org/baltic-crew/invitations/00000000-0000-4000-8000-000000000001/respond",
};

describe("the answer to an invitation (FR-O1 AC8)", () => {
  it("offers Accept and Decline as buttons that only open a confirmation, since an answer is final", () => {
    const html = renderToStaticMarkup(<InvitationAnswer {...props} />);
    expect(html).toContain("An answer cannot be changed.");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Accept<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Decline<\/button>/);
    expect(html).not.toContain("Accept invitation");
    expect(answerInvitation).not.toHaveBeenCalled();
  });

  it("asks for the acceptance to be confirmed, with a way back", () => {
    const html = renderToStaticMarkup(<AcceptConfirmation {...props} onClose={vi.fn()} />);
    expect(html).toContain("This is final: Acme Bau sees that your company accepted");
    expect(html).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*>Accept invitation<\/button>/);
    expect(answerInvitation).not.toHaveBeenCalled();
  });
});
