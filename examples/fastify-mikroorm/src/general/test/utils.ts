import { override, r, run } from "@bluelibs/runner";
import { ormConfig } from "#/db/resources/orm.config";
import { BetterSqliteDriver } from "@mikro-orm/better-sqlite";
import type {
  DebugConfig,
  OverridableElements,
  RegisterableItems,
} from "@bluelibs/runner";
import { env } from "#/general/resources/env.resource";

Error.stackTraceLimit = 100;
// Override ORM config for tests to use in-memory SQLite
export const testOrmConfig = override(ormConfig, async (_cfg, { entitiesHolder }) => ({
    driver: BetterSqliteDriver,
    dbName: ":memory:",
    entities: [...Object.values(entitiesHolder)],
    extensions: [],
    // migrations are not needed for SQLite in-memory tests
  }),
);

type BuildTestRunnerOptions = {
  register: RegisterableItems[];
  overrides?: OverridableElements[];
  debug?: DebugConfig | "normal" | "verbose";
};

// Minimal runner builder for tests
export async function buildTestRunner(options: BuildTestRunnerOptions) {
  const harness = r
    .resource("harness")
    .register([env, ...options.register])
    .overrides(options.overrides ?? [])
    .build();

  // By default we don't want tests to expose logs. Do it when necessary.
  return run(harness, {
    debug: options.debug ?? undefined,
    logs: { printThreshold: null },
  });
}
