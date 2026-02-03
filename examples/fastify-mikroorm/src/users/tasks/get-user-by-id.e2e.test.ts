import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { httpRoute } from "#/http/tags";
import { fastify } from "#/http/resources/fastify.resource";
import { fastifyRouter } from "#/http/resources/fastify-router.resource";
import { db } from "#/db/resources/db.resource";
import { users } from "#/users";

describe("GET /user/:id", () => {
  it("returns user by id and 404 for missing", async () => {
    const rr = await buildTestRunner({
      register: [httpRoute, fastify, fastifyRouter, db, users],
      overrides: [testOrmConfig],
    });

    try {
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();
      const f = rr.getResourceValue(fastify);

      const email = "byid.user@example.test";
      const password = "s3cret";
      const name = "ById User";

      // Register a user to obtain token and id
      const reg = await f.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, password, name },
      });
      expect(reg.statusCode).toBe(200);
      const regBody = reg.json();
      const token = regBody.token as string;
      const userId = regBody.user.id as string;

      // Success path
      const ok = await f.inject({
        method: "GET",
        url: `/user/${userId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().email).toBe(email);

      // 404 path
      const missing = await f.inject({
        method: "GET",
        url: "/user/does-not-exist",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await rr.dispose();
    }
  });
});
