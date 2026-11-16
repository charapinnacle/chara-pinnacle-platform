import { Building2, Handshake, UserRound, UsersRound } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import type { AccountChoice, PartnerType } from "@/lib/validation/sign-up";

const kindOptions = [
  { value: "worker", label: "I'm a worker", icon: UserRound, description: "Find work and apply to vacancies." },
  { value: "company", label: "I'm an employer", icon: Building2, description: "Publish vacancies and hire." },
] as const;

// The partner choices of release 2a (FR-J1), after the two of Phase 1.
const partnerOptions = [
  {
    value: "recruitment_company",
    label: "I'm a recruitment company",
    icon: Handshake,
    description: "Find candidates for employers. Listed after a review by our team.",
  },
  {
    value: "staffing_company",
    label: "I'm a staffing company",
    icon: UsersRound,
    description: "Supply workers to employers. Listed after a review by our team.",
  },
] as const;

export const partnerTypeLabels: Record<PartnerType, string> = {
  recruitment_company: "Recruitment company",
  staffing_company: "Staffing company",
};

// The choices whose documents were loaded: the partner documents are read only while release 2a is on.
export function accountChoiceOptions(documents: Partial<Record<AccountChoice, unknown>>) {
  return [...kindOptions, ...partnerOptions].filter((option) => documents[option.value] !== undefined);
}

export const KIND_IS_FINAL =
  `This choice cannot be changed later. To use ${BRAND_NAME} as both worker and employer, register a second account with a different email address.`;
