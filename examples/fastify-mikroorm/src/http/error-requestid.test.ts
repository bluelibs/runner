import { buildTestRunner, testOrmConfig } from "../test/utils";
import { httpRoute } from "./tags";
import { fastify } from "./resources/fastify.resource";
import { fastifyRouter } from "./resources/fastify-router.resource";
import { task } from "@bluelibs/runner";
import { z } from "zod";
import { auth as authResource } from "../users/resources/auth.resource";
import { db } from "../db/resources/db.resource";
import { HTTPError } from "./http-error";

describe("error handler and request id", () => {
  it("maps HTTPError and sets x-request-id", async () => {
    const failing = task({
      id: "app.tests.http.failing",
      meta: { title: "Failing", description: "Throws HTTPError" },
      inputSchema: z.object({ ok: z.boolean().optional() }).optional(),
      tags: [httpRoute.with({ method: "post", path: "/fail" })],
      run: async () => {
        throw new HTTPError(422, "Invalid payload");
      },
    });

    const rr = await buildTestRunner({
      register: [httpRoute, fastify, fastifyRouter, authResource, db, failing],
      overrides: [testOrmConfig],
    });

    try {
      const f = rr.getResourceValue(fastify);
      const res = await f.inject({ method: "POST", url: "/fail", payload: {} });
      expect(res.statusCode).toBe(422);
      expect(res.headers["x-request-id"]).toBeTruthy();
      const body = res.json();
      expect(body.error).toBe("Invalid payload");
    } finally {
      await rr.dispose();
    }
  });
});
