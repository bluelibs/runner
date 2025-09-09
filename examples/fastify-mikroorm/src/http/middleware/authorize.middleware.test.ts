import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { httpRoute } from "#/http/tags";
import { fastify } from "#/http/resources/fastify.resource";
import { fastifyRouter } from "#/http/resources/fastify-router.resource";
import { db } from "#/db/resources/db.resource";
import { users } from "#/users";

describe("authorize middleware (roles)", () => {
  it("enforces auth required and admin role on GET /users", async () => {
    const rr = await buildTestRunner({
      register: [httpRoute, fastify, fastifyRouter, db, users],
      overrides: [testOrmConfig],
    });

    try {
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();
      const f = rr.getResourceValue(fastify);

      // 1) Unauthenticated request -> 401
      const unauth = await f.inject({ method: "GET", url: "/users" });
      expect(unauth.statusCode).toBe(401);

      // Prepare a user: register to obtain a token
      const email = "authz@example.test";
      const password = "s3cret";
      const name = "Auth Z";

      const reg = await f.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, password, name },
      });
      expect(reg.statusCode).toBe(200);
      const token = reg.json().token as string;
      expect(token).toBeTruthy();

      // 2) Authenticated but missing role -> 403
      const noRole = await f.inject({
        method: "GET",
        url: "/users",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(noRole.statusCode).toBe(403);

      // 3) Authenticated with non-admin role -> 403
      const wrongRole = await f.inject({
        method: "GET",
        url: "/users",
        headers: { Authorization: `Bearer ${token}`, "x-user-role": "user" },
      });
      expect(wrongRole.statusCode).toBe(403);

      // 4) Authenticated with admin role -> 200 + returns list
      const ok = await f.inject({
        method: "GET",
        url: "/users",
        headers: { Authorization: `Bearer ${token}`, "x-user-role": "admin" },
      });
      expect(ok.statusCode).toBe(200);
      const list = ok.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0]).toHaveProperty("email");
    } finally {
      await rr.dispose();
    }
  });
});
