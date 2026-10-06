import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const CONTAINER = "supabase_db_chara-pinnacle";

const PSQL_ARGS = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-c"];

function psql(sql: string): string {
  return execFileSync("docker", [...PSQL_ARGS, sql], { encoding: "utf8" });
}

export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function query<T>(sql: string): T[] {
  const out = psql(`select coalesce(json_agg(t), '[]') from (${sql}) t`).trim();
  return JSON.parse(out) as T[];
}

export function execute(sql: string): string {
  return psql(sql);
}

// A statement run in a session of its own that does not block the test, for the tests that need two sessions at once.
export async function executeAsync(sql: string): Promise<string> {
  const { stdout } = await promisify(execFile)("docker", [...PSQL_ARGS, sql], { encoding: "utf8" });
  return stdout;
}
