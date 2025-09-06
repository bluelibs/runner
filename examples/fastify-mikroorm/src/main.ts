import { run, resource } from "@bluelibs/runner";
import { dev } from "@bluelibs/runner-dev";
import { db, fixtures } from "./db/resources";
import { http } from "./http";
import { users } from "./users";
import { env } from "./general";

// Minimal Runner app using runner-dev's dev resource
const app = resource({
  id: "app.root",
  // Register fixtures after DB so seeding can run conditionally
  register: [env, db, fixtures, http, users, dev.with({ port: 1337 })],
});

run(app, {
  // debug: "normal",
  logs: {
    printThreshold: "info",
  },
})
  .then(({ logger }) => {})
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
