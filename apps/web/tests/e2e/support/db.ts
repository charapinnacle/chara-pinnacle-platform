import { execFileSync } from "node:child_process";

const CONTAINER = "supabase_db_chara-pinnacle";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  );
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
