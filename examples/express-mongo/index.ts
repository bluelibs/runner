// TODO
import express from "express";
import { resource, run } from "@bluelibs/runner";

const app = resource({
  id: "app",
  init: async (config: { port: number }, deps) => {
    const app = express();
    const port = 3000;

    const server = app.listen(3000);

    return server;
  },
  dispose: async (server, deps) => {
    server.dispose();
  },
});

run(app, { port: 3000 }).then((result) => {
  console.log("Server started");
});
