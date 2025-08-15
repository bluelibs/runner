import { db } from "./db/database";
import { resource } from "@bluelibs/runner";
import { http } from "./http";
import { users } from "./users";
import { appConfig } from "./app.config";

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
  ],
});
