import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { httpRoute } from "#/http/tags";
import { fastify } from "#/http/resources/fastify.resource";
import { fastifyRouter } from "#/http/resources/fastify-router.resource";
import { db } from "#/db/resources/db.resource";
import { users } from "./index";

describe("auth flows", () => {
  it("registers, logs in, reads /me and logs out", async () => {
    const rr = await buildTestRunner({
      register: [httpRoute, fastify, fastifyRouter, db, users],
      overrides: [testOrmConfig],
    });

    try {
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();
      const f = rr.getResourceValue(fastify);

      const email = "new.user@example.test";
      const password = "s3cret";
      const name = "New User";

      // Register
      const reg = await f.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, password, name },
      });
      expect(reg.statusCode).toBe(200);
      const regBody = reg.json();
      expect(regBody.token).toBeTruthy();
      expect(regBody.user.email).toBe(email);
      const setCookie = reg.headers["set-cookie"] as
        | string
        | string[]
        | undefined;
      const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieValue).toBeTruthy();
      const cookieAuth = cookieValue!.split(";")[0]; // "auth=..."

      // /me with Bearer token
      const meWithBearer = await f.inject({
        method: "GET",
        url: "/me",
        headers: { Authorization: `Bearer ${regBody.token}` },
      });
      expect(meWithBearer.statusCode).toBe(200);
      expect(meWithBearer.json().email).toBe(email);

      // /me with Cookie
      const meWithCookie = await f.inject({
        method: "GET",
        url: "/me",
        headers: { cookie: cookieAuth },
      });
      expect(meWithCookie.statusCode).toBe(200);

      // Wrong password login
      const badLogin = await f.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: "wrong" },
      });
      expect(badLogin.statusCode).toBe(401);

      // Correct login
      const goodLogin = await f.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password },
      });
      expect(goodLogin.statusCode).toBe(200);

      // Logout
      const logout = await f.inject({ method: "POST", url: "/auth/logout" });
      expect(logout.statusCode).toBe(200);
      const clearCookie = logout.headers["set-cookie"] as
        | string
        | string[]
        | undefined;
      expect(clearCookie).toBeTruthy();
    } finally {
      await rr.dispose();
    }
  });
});
