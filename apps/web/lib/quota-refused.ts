// A refused quota (SA-06) rolls back in the database with its count, so this line is the record of how often the quotas
// are hit. Operations route log lines by the key "alert" (docs/runbooks/security-checklist.md item 7); it holds no
// personal data.
export function reportQuotaRefused(quota: "audited_write" | "worker_documents", flow: "document" | "vacancy" | "note"): void {
  console.warn(JSON.stringify({ alert: "quota_refused", quota, flow }));
}
