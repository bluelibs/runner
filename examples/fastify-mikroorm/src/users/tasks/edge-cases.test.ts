import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { httpRoute } from "#/http/tags";
import { fastify } from "#/http/resources/fastify.resource";
import { fastifyRouter } from "#/http/resources/fastify-router.resource";
import { db } from "#/db/resources/db.resource";
import { users } from "#/users";
import { auth as authResource } from "#/users/resources/auth.resource";

describe("user task edge cases", () => {
  it("register conflict (409) and me 401 when user missing", async () => {
    const rr = await buildTestRunner({
      register: [httpRoute, fastify, fastifyRouter, db, users],
      overrides: [testOrmConfig],
    });

    try {
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();
      const f = rr.getResourceValue(fastify);

      const email = "dup@example.test";
      const password = "s3cret";
      const name = "Dup User";

      const r1 = await f.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, password, name },
      });
      expect(r1.statusCode).toBe(200);

      const r2 = await f.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, password, name },
      });
      expect(r2.statusCode).toBe(409);

      // Craft a token referencing a non-existing user by logging out (clears cookie) and using a fake Bearer
      const token = rr
        .getResourceValue(authResource)
        .createSessionToken("non-existent-id");
      const me = await f.inject({
        method: "GET",
        url: "/me",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(401);
    } finally {
      await rr.dispose();
    }
  });

  it("login sets Set-Cookie header", async () => {
    const rr = await buildTestRunner({
      register: [httpRoute, fastify, fastifyRouter, db, users],
      overrides: [testOrmConfig],
    });

    try {
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();
      const f = rr.getResourceValue(fastify);

      const email = "cookie@example.test";
      const password = "s3cret";
      const name = "Cookie User";

      await f.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, password, name },
      });
      const login = await f.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password },
      });
      expect(login.statusCode).toBe(200);
      const setCookie = login.headers["set-cookie"] as
        | string
        | string[]
        | undefined;
      expect(setCookie).toBeTruthy();
    } finally {
      await rr.dispose();
    }
  });
});
