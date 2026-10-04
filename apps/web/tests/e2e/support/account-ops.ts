// The browser tests play the scheduler: they call the account-ops process that supabase/functions/serve-local.sh starts
// (playwright.config.ts), as the minute job of the database would on a hosted project.
const ENDPOINT = "http://127.0.0.1:54430";
const SECRET = "local-scheduler-secret";

export async function runAccountOps(): Promise<{ processed: number; failed: number }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: "Bearer scheduler", "x-edge-secret": SECRET, "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`account-ops answered ${response.status}`);
  return (await response.json()) as { processed: number; failed: number };
}
