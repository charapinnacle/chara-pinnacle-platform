import { Building2, UserRound } from "lucide-react";

export type Kind = "worker" | "company";

export const kindOptions = [
  { value: "worker", label: "I'm a worker", icon: UserRound },
  { value: "company", label: "I'm an employer", icon: Building2 },
] as const;

export const KIND_IS_FINAL =
  "This choice cannot be changed later. To use CHARA as both worker and employer, register a second account with a different email address.";
