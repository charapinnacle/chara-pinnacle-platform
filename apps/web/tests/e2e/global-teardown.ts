import { execFileSync } from "node:child_process";
import path from "node:path";

// The versions project publishes legal documents, which the append-only consents ledger keeps for good.
// Resetting the local stack afterwards leaves it as `npm run db:test` expects; CI starts every job fresh.
export default function globalTeardown(): void {
  if (process.env.CI) return;
  execFileSync("npx", ["supabase", "db", "reset"], {
    cwd: path.join(__dirname, "../../../.."),
    stdio: "inherit",
  });
}
