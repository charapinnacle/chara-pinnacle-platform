import { spawnSync } from "node:child_process";
import { literal } from "./db";

const CONTAINER = "supabase_db_chara-pinnacle";

// A statement as a signed-in user would send it through the API: the role and the token claims are those of the
// session, so the row-level security policies and auth.uid() answer for that user. Returns the message of a refusal.
export function runAs(userId: string, sql: string): string {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1" });
  const script = `set role authenticated; select set_config('request.jwt.claims', ${literal(claims)}, false); ${sql}`;
  const run = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", script], {
    encoding: "utf8",
  });
  return run.status === 0 ? "ok" : run.stderr.trim();
}

// The lines of the database log that mention a text, as the database container wrote them.
export function databaseLogLines(text: string): string[] {
  const run = spawnSync("docker", ["logs", "--tail", "20000", CONTAINER], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return `${run.stdout}\n${run.stderr}`.split("\n").filter((line) => line.includes(text));
}
