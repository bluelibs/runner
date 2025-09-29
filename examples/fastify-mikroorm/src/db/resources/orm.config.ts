import { r } from "@bluelibs/runner";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { entities } from "./entities/index";
import { Migrator } from "@mikro-orm/migrations";
import { Options } from "@mikro-orm/core";
import { env } from "#/general";

export const ormConfig = r
  .resource("app.db.resources.orm.config")
  .meta({
    title: "ORM Configuration",
    description:
      "MikroORM configuration with PostgreSQL driver and migration settings",
  })
  .dependencies({ entitiesHolder: entities, env })
  .init(async (_, { entitiesHolder, env }): Promise<Options> => ({
    clientUrl: env.DATABASE_URL,
    driver: PostgreSqlDriver,
    extensions: [Migrator],
    entities: [...Object.values(entitiesHolder)],
    migrations: {
      path: "./dist/db/migrations",
      pathTs: "./src/db/migrations",
    },
  }))
  .build();
