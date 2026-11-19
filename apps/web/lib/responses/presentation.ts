import type { Database } from "@chara-pinnacle/db-types";
import { formatCount, formatDate } from "@/lib/i18n/format";
import type { StatusTone } from "@/lib/status-tone";

type Enums = Database["public"]["Enums"];
export type ResponseStatus = Enums["response_status"];
export type FeeModel = Enums["fee_model"];

export const responseStatuses = [
  "submitted",
  "updated",
  "withdrawn",
  "shortlisted",
  "selected",
  "declined",
] as const satisfies readonly ResponseStatus[];

export const feeModels = [
  "fee_per_hire",
  "percent_first_year_salary",
  "hourly_rate",
  "monthly_rate",
  "on_request",
] as const satisfies readonly FeeModel[];

// Decision 3.3: every fee model is offered to both partner types (FR-O2 open point).
export const feeModelLabels: Record<FeeModel, string> = {
  fee_per_hire: "Fee per hire",
  percent_first_year_salary: "Percentage of first-year salary",
  hourly_rate: "Hourly rate",
  monthly_rate: "Monthly rate",
  on_request: "On request",
};

export const feeModelDescriptions: Record<FeeModel, string> = {
  fee_per_hire: "A fixed amount for each worker hired.",
  percent_first_year_salary: "A share of each worker's salary in the first year.",
  hourly_rate: "An amount per hour worked, for staffing.",
  monthly_rate: "An amount per month worked, for staffing.",
  on_request: "You agree the fee with the employer later.",
};

// The fee models that carry an amount in a currency; a percentage has no currency and On request no amount (the check
// partner_responses_fee of V44).
export function hasCurrency(model: FeeModel | ""): boolean {
  return model === "fee_per_hire" || model === "hourly_rate" || model === "monthly_rate";
}

export function hasAmount(model: FeeModel | ""): boolean {
  return model !== "" && model !== "on_request";
}

// Decision 3.4, FR-O2 AC10: next to the fee fields of the form and of every read view.
export const NOT_A_PARTY =
  "Chara Pinnacle is not a party to any agreement or payment between you and the employer";
export const NOT_A_PARTY_EMPLOYER =
  "Chara Pinnacle is not a party to any agreement or payment between you and the partner";

const amountFormat = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

// The proposal's fee in words, as the partner entered it: no conversion between currencies.
export function feeText(model: FeeModel, amount: number | null, currency: string | null): string {
  if (model === "on_request" || amount === null) return feeModelLabels.on_request;
  if (model === "percent_first_year_salary") return `${percentFormat.format(amount)}% of first-year salary`;
  const money = `${currency ?? ""} ${amountFormat.format(amount)}`.trim();
  if (model === "hourly_rate") return `${money} per hour`;
  if (model === "monthly_rate") return `${money} per month`;
  return `${money} per hire`;
}

// What the partner reads of its own response (NFR-U4).
export const partnerStatusLabels: Record<ResponseStatus, string> = {
  submitted: "Sent",
  updated: "Changed",
  withdrawn: "Withdrawn",
  shortlisted: "Shortlisted",
  selected: "Selected",
  declined: "Declined",
};

// What the employer reads: an edit keeps the response received; the badge Updated says it changed since it was last
// opened (FR-O2 AC9).
export const employerStatusLabels: Record<ResponseStatus, string> = {
  submitted: "Received",
  updated: "Received",
  withdrawn: "Withdrawn",
  shortlisted: "Shortlisted",
  selected: "Selected",
  declined: "Declined",
};

export const responseTones: Record<ResponseStatus, StatusTone> = {
  submitted: "info",
  updated: "info",
  withdrawn: "neutral",
  shortlisted: "success",
  selected: "success",
  declined: "neutral",
};

export const UPDATED_BADGE = "Updated";

// The moves of update_response and withdraw_response: until the employer decides (FR-N2, FR-O2).
export function isLive(status: ResponseStatus): boolean {
  return status === "submitted" || status === "updated";
}

// The partner's next step on its response (NFR-U4).
export const partnerNextSteps: Record<ResponseStatus, string> = {
  submitted: "The employer has your response. You can change or withdraw it until the employer decides.",
  updated: "The employer has your response and sees that you changed it. You can change or withdraw it until the employer decides.",
  withdrawn: "You withdrew this response. It still counts against this month's responses and cannot be sent again.",
  shortlisted: "The employer shortlisted your response, so it can no longer be changed or withdrawn.",
  selected: "The employer selected your company for this requirement, so the response can no longer be changed or withdrawn.",
  declined: "The employer declined your response.",
};

// The employer's view of one response (NFR-U4).
export const employerNextSteps: Record<ResponseStatus, string> = {
  submitted: "Read the proposal and its documents.",
  updated: "Read the proposal and its documents. The history shows what the partner changed.",
  withdrawn: "The partner withdrew this response.",
  shortlisted: "You shortlisted this response.",
  selected: "You selected this partner.",
  declined: "You declined this response.",
};

export function responseCountText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "response" : "responses"}`;
}

export function myResponsesCountText(count: number, more: boolean): string {
  return `${responseCountText(count)} shown${more ? ", more on the next page" : ""}`;
}

// The fields of a proposal in the order of the form, as list_response_versions names them (private.partner_response_fields).
export const responseFields = [
  "capacity",
  "available_from",
  "timeline_note",
  "experience_note",
  "fee_model",
  "fee_amount",
  "fee_currency",
  "notes",
] as const;
export type ResponseField = (typeof responseFields)[number];

export const responseFieldLabels: Record<ResponseField, string> = {
  capacity: "Workers offered",
  available_from: "Available from",
  timeline_note: "Timeline",
  experience_note: "Relevant experience",
  fee_model: "Fee model",
  fee_amount: "Fee amount",
  fee_currency: "Fee currency",
  notes: "Notes",
};

export function workersOfferedText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "worker" : "workers"}`;
}

// "You can attach up to five documents" (FR-O2 AC5): the limit is a setting (decision 3.3), in words while it is small.
const numberWords = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

export function documentsLimitText(max: number): string {
  if (max === 1) return "You can attach one document";
  return `You can attach up to ${numberWords[max] ?? formatCount(max)} documents`;
}

// One version of a proposal as list_response_versions keeps it (FR-O2 AC8, AC9).
export type ResponsePayload = {
  capacity: number | null;
  availableFrom: string | null;
  timelineNote: string | null;
  experienceNote: string | null;
  feeModel: FeeModel | null;
  feeAmount: number | null;
  feeCurrency: string | null;
  notes: string | null;
};

export type ResponseVersion = { version: number; createdAt: string; changedFields: ResponseField[]; payload: ResponsePayload };

export type ResponseChangeLine = { label: string; before: string; after: string };

const NOT_GIVEN = "Not given";

function payloadFee(payload: ResponsePayload): string {
  return payload.feeModel ? feeText(payload.feeModel, payload.feeAmount, payload.feeCurrency) : NOT_GIVEN;
}

function valueText(field: Exclude<ResponseField, "fee_model" | "fee_amount" | "fee_currency">, payload: ResponsePayload): string {
  switch (field) {
    case "capacity":
      return payload.capacity === null ? NOT_GIVEN : workersOfferedText(payload.capacity);
    case "available_from":
      return payload.availableFrom ? formatDate(payload.availableFrom) : NOT_GIVEN;
    case "timeline_note":
      return payload.timelineNote ?? NOT_GIVEN;
    case "experience_note":
      return payload.experienceNote ?? NOT_GIVEN;
    case "notes":
      return payload.notes ?? NOT_GIVEN;
  }
}

const isFeeField = (field: ResponseField): field is "fee_model" | "fee_amount" | "fee_currency" =>
  field === "fee_model" || field === "fee_amount" || field === "fee_currency";

// What one version changed against the one before, in the order of the form: the three fee fields read as one line ("EUR
// 1,500.00 per hire" to "EUR 1,400.00 per hire"). Version 1 changed nothing.
export function versionChangeLines(version: ResponseVersion, previous: ResponseVersion | undefined): ResponseChangeLine[] {
  if (!previous) return [];
  const lines: ResponseChangeLine[] = [];
  for (const field of responseFields) {
    if (!version.changedFields.includes(field)) continue;
    if (isFeeField(field)) {
      if (lines.some((line) => line.label === "Fee")) continue;
      lines.push({ label: "Fee", before: payloadFee(previous.payload), after: payloadFee(version.payload) });
      continue;
    }
    lines.push({ label: responseFieldLabels[field], before: valueText(field, previous.payload), after: valueText(field, version.payload) });
  }
  return lines;
}
