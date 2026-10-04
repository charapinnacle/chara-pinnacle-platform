// The browser tests play the scheduler: they call the account-ops process that supabase/functions/serve-local.sh starts
// (playwright.config.ts defines the port and the secret), as the minute job of the database would on a hosted project.
export async function runAccountOps(): Promise<{ processed: number; failed: number }> {
  const response = await fetch(`http://127.0.0.1:${process.env.ACCOUNT_OPS_PORT}`, {
    method: "POST",
    headers: { authorization: "Bearer scheduler", "x-edge-secret": process.env.EDGE_SHARED_SECRET ?? "" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`account-ops answered ${response.status}`);
  return (await response.json()) as { processed: number; failed: number };
}
