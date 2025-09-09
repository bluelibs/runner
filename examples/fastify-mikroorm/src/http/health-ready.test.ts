import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { httpRoute } from "./tags";
import { fastify } from "./resources/fastify.resource";
import { fastifyRouter } from "./resources/fastify-router.resource";
import { db } from "#/db/resources/db.resource";
import { auth as authResource } from "#/users/resources/auth.resource";
import { healthz } from "./tasks/healthz.task";
import { readyz } from "./tasks/readyz.task";

describe("health and readiness endpoints", () => {
  it("respond to /healthz and /readyz", async () => {
    const rr = await buildTestRunner({
      register: [
        httpRoute,
        fastify,
        fastifyRouter,
        healthz,
        readyz,
        authResource,
        db,
      ],
      overrides: [testOrmConfig],
    });
    try {
      const f = rr.getResourceValue(fastify);
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();

      const health = await f.inject({ method: "GET", url: "/healthz" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok" });

      const ready = await f.inject({ method: "GET", url: "/readyz" });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({ status: "ok" });
    } finally {
      await rr.dispose();
    }
  });
});
