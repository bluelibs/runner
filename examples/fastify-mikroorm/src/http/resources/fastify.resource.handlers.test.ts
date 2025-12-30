import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { httpRoute } from "#/http/tags";
import { fastify } from "./fastify.resource";
import { fastifyRouter } from "./fastify-router.resource";
import { db } from "#/db/resources/db.resource";
import { auth as authResource } from "#/users/resources/auth.resource";
import { task } from "@bluelibs/runner";
import { z } from "zod";

describe("fastify error handler branches", () => {
  it("handles validation error (400), statusCode errors, and fallback 500", async () => {
    const badInput = task({
      id: "tests.http.badInput",
      meta: { title: "BadInput", description: "validation" },
      inputSchema: z.object({ must: z.string() }),
      tags: [httpRoute.with({ method: "post", path: "/bad-input" })],
      run: async () => "ok",
    });

    const statusErr = task({
      id: "tests.http.status",
      meta: { title: "StatusErr", description: "status code" },
      inputSchema: z.undefined(),
      tags: [httpRoute.with({ method: "get", path: "/status-err" })],
      run: async () => {
        const e = new Error("nope");
        (e as any).statusCode = 418;
        throw e;
      },
    });

    const boom = task({
      id: "tests.http.boom",
      meta: { title: "Boom", description: "generic" },
      inputSchema: z.undefined(),
      tags: [httpRoute.with({ method: "get", path: "/boom" })],
      run: async () => {
        throw new Error("boom");
      },
    });

    const nameValidationErr = task({
      id: "tests.http.nameValidation",
      meta: {
        title: "NameValidation",
        description: "name === ValidationError",
      },
      inputSchema: z.undefined(),
      tags: [httpRoute.with({ method: "get", path: "/name-validation" })],
      run: async () => {
        const e = new Error("bad");
        (e as any).name = "ValidationError";
        throw e;
      },
    });

    const rr = await buildTestRunner({
      register: [
        httpRoute,
        fastify,
        fastifyRouter,
        authResource,
        db,
        badInput,
        statusErr,
        boom,
        nameValidationErr,
      ],
      overrides: [testOrmConfig],
    });

    try {
      const f = rr.getResourceValue(fastify);

      const v = await f.inject({
        method: "POST",
        url: "/bad-input",
        payload: {},
      });
      expect(v.statusCode).toBe(400);

      const s = await f.inject({ method: "GET", url: "/status-err" });
      expect(s.statusCode).toBe(418);

      const b = await f.inject({ method: "GET", url: "/boom" });
      expect(b.statusCode).toBe(500);

      const nv = await f.inject({ method: "GET", url: "/name-validation" });
      expect(nv.statusCode).toBe(400);

      // 'name = ValidationError' path is covered by /name-validation
    } finally {
      await rr.dispose();
    }
  });
});
