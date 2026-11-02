import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Env } from "./types";
export function testDatabase(through = 7) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrate = (file: string) =>
    sqlite.exec(
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  for (const file of [
    "0001_core.sql",
    "0002_ingestion.sql",
    "0003_reconciliation.sql",
    "0004_webhook_inbox.sql",
    "0005_session_rotation.sql",
    "0006_meta_accounts.sql",
    "0007_sync_health.sql",
  ].slice(0, through))
    migrate(file);
  function prep(sql: string, args: unknown[] = []) {
    const execute = () => {
      const stmt = sqlite.prepare(sql),
        result = stmt.all(...(args as (string | number | null)[]));
      const changes = Number(
        (sqlite.prepare("SELECT changes() AS n").get() as { n: number }).n,
      );
      return { success: true, results: result, meta: { changes } };
    };
    return {
      bind: (...values: unknown[]) => prep(sql, values),
      first: async (column?: string) => {
        const row = execute().results[0] || null;
        return column && row ? row[column] : row;
      },
      all: async () => execute(),
      run: async () => execute(),
      execute,
    };
  }
  const DB = {
    prepare: prep,
    batch: async (statements: ReturnType<typeof prep>[]) => {
      sqlite.exec("BEGIN");
      try {
        const values = statements.map((s) => s.execute());
        sqlite.exec("COMMIT");
        return values;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as Env["DB"];
  return { DB, sqlite, migrate, close: () => sqlite.close() };
}
