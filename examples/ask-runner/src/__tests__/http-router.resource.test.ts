import express from "express";
import http from "http";
import { resources, r, run } from "@bluelibs/runner";

import { registerTaggedHttpRoutes } from "../app/http/http-router.resource";
import { httpRoute } from "../app/http/http-route.tag";
import { registerHttpErrorHandler } from "../app/http/http.resource";

describe("ask-runner tagged router discovery", () => {
  async function request(
    app: express.Express,
    input: {
      method: "GET" | "POST";
      path: string;
      headers?: Record<string, string>;
      body?: unknown;
    },
  ) {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an ephemeral HTTP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}${input.path}`, {
      method: input.method,
      headers: input.headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    const text = await response.text();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    return { status: response.status, text };
  }

  test("startup tag discovery registers tagged tasks as routes", async () => {
    const pingTask = r
      .task("pingTask")
      .tags([
        httpRoute.with({
          method: "get",
          path: "/ping",
          responseType: "json",
          inputFrom: "none",
        }),
      ])
      .run(async () => ({ ok: true }))
      .build();

    const appResource = r
      .resource("appResource")
      .init(async () => {
        const app = express();
        app.use(express.json());
        return app;
      })
      .build();

    const routerResource = r
      .resource("routerResource")
      .dependencies({
        app: appResource,
        httpRoute: httpRoute.startup(),
        taskRunner: resources.taskRunner,
      })
      .init(async (_config, deps) => {
        registerTaggedHttpRoutes({
          adminSecret: "top-secret",
          app: deps.app,
          routes: deps.httpRoute.tasks as Parameters<typeof registerTaggedHttpRoutes>[0]["routes"],
          taskRunner: deps.taskRunner,
        });
        registerHttpErrorHandler(deps.app);
        return {};
      })
      .build();

    const root = r
      .resource("root")
      .register([httpRoute, appResource, routerResource, pingTask])
      .build();

    const runtime = await run(root);

    try {
      const app = runtime.getResourceValue(appResource);
      const response = await request(app, {
        method: "GET",
        path: "/ping",
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.text)).toEqual({ ok: true });
    } finally {
      await runtime.dispose();
    }
  });
});
