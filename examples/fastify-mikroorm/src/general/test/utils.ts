import { override, r, run } from "@bluelibs/runner";
import { ormConfig } from "#/db/resources/orm.config";
import { BetterSqliteDriver } from "@mikro-orm/better-sqlite";
import type { DebugConfig } from "@bluelibs/runner";
import { env } from "#/general/resources/env.resource";

Error.stackTraceLimit = 100;
// Override ORM config for tests to use in-memory SQLite
export const testOrmConfig = override(ormConfig, {
  init: async (_cfg, { entitiesHolder }) => ({
    driver: BetterSqliteDriver,
    dbName: ":memory:",
    entities: [...Object.values(entitiesHolder)],
    extensions: [],
    // migrations are not needed for SQLite in-memory tests
  }),
});

// Minimal runner builder for tests
export async function buildTestRunner(options: {
  register: any[];
  overrides?: any[];
  debug?: DebugConfig | "normal" | "verbose";
}) {
  const harness = r
    .resource("test.harness")
    .register([env, ...options.register])
    .overrides([...(options.overrides || [])])
    .build();

  // By default we don't want tests to expose logs. Do it when necessary.
  return run(harness, {
    debug: options.debug ?? undefined,
    logs: { printThreshold: null },
  });
}
