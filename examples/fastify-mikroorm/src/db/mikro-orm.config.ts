import { resource, run } from "@bluelibs/runner";
import { entities } from "./resources/entities";
import { ormConfig } from "./resources/orm.config";
import { defineConfig } from "@mikro-orm/core";

// We are creating a new resource to bootstrap MikroORM and get the config
// Nothing else is initialized here.
const cli = resource({
  id: "app.db.resources.cli",
  register: [entities, ormConfig],
});

async function buildConfig() {
  const rr = await run(cli, {
    logs: {
      printThreshold: "error",
    },
  });

  return defineConfig(rr.getResourceValue(ormConfig));
}

module.exports = buildConfig();
