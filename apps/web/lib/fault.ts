import "server-only";
import { randomBytes } from "node:crypto";

type FaultError = { code?: string; message: string; details?: string | null };

// A system fault is shown with a short reference that the server log holds next to the error code, so support finds one from
// the other (D89). The detail of the database's own refusals (CHARA_*) names a setting or a field; other errors are logged
// without it, because the detail of a constraint error can quote the values of a row.
export function logFault(action: string, error: FaultError): string {
  const reference = randomBytes(4).toString("hex").toUpperCase();
  console.error(`${action} failed`, {
    reference,
    code: error.code,
    message: error.message,
    ...(error.message.startsWith("CHARA_") ? { detail: error.details } : {}),
  });
  return reference;
}

export function faultMessage(reference: string): string {
  return `Something went wrong on our side and nothing was changed. Please try again later. Reference: ${reference}.`;
}
