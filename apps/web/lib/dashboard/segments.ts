import type { PartnerType } from "@/lib/validation/sign-up";

// Kept apart from the dashboard logic: the navigation, which the browser loads on every signed-in page, needs only this.
export type PartnerSegment = "recruitment" | "staffing";
export type CompanySegment = "employer" | PartnerSegment;

export const partnerSegments = { recruitment_company: "recruitment", staffing_company: "staffing" } as const satisfies Record<
  PartnerType,
  PartnerSegment
>;

export function segmentOf(type: "employer" | PartnerType): CompanySegment {
  return type === "employer" ? "employer" : partnerSegments[type];
}
