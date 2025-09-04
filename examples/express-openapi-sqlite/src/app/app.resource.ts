import { db } from "./db/resources/database";
import { resource } from "@bluelibs/runner";
import { http } from "./http";
import { users } from "./users";
import { appConfig } from "./app.config";
import { dev } from "@bluelibs/runner-dev";

const ENABLE_DEV = process.env.NODE_ENV === "development";
const extra = ENABLE_DEV ? [dev.with({ port: 1337 })] : [];

export const app = resource({
  id: "app.main",
  register: [
    appConfig,
    db.with({
      filename: "./data.db",
      verbose: true,
    }),
    http,
    users,
    ...extra,
  ],
});
