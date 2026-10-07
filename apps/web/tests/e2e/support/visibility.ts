import { spawnSync } from "node:child_process";
import { CONTAINER, literal, PSQL_ARGS } from "./db";

// The log is read from a minute before this run began, so a busy stack cannot push a line out of a fixed tail.
const since = new Date(Date.now() - 60_000).toISOString();

// A statement as a signed-in user would send it through the API: the role and the token claims are those of the
// session, so the row-level security policies and auth.uid() answer for that user. Returns the message of a refusal.
export function runAs(userId: string, sql: string): string {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1" });
  const script = `set role authenticated; select set_config('request.jwt.claims', ${literal(claims)}, false); ${sql}`;
  const run = spawnSync("docker", [...PSQL_ARGS, script], { encoding: "utf8" });
  return run.status === 0 ? "ok" : run.stderr.trim();
}

// The lines of the database log that mention a text, as the database container wrote them.
export function databaseLogLines(text: string): string[] {
  const run = spawnSync("docker", ["logs", "--since", since, CONTAINER], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return `${run.stdout}\n${run.stderr}`.split("\n").filter((line) => line.includes(text));
}
