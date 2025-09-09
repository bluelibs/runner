import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { httpRoute } from "#/http/tags";
import { fastify } from "#/http/resources/fastify.resource";
import { fastifyRouter } from "#/http/resources/fastify-router.resource";
import { db } from "#/db/resources/db.resource";
import { users } from "#/users";

describe("swagger route params and meta", () => {
  it("exposes path params and meta in OpenAPI for /user/:id", async () => {
    const rr = await buildTestRunner({
      register: [httpRoute, fastify, fastifyRouter, db, users],
      overrides: [testOrmConfig],
    });

    try {
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();
      const f = rr.getResourceValue(fastify);

      // Fetch generated OpenAPI JSON (served by swagger-ui at routePrefix)
      const res = await f.inject({ method: "GET", url: "/swagger/json" });
      expect(res.statusCode).toBe(200);
      const spec = res.json();

      // Path should be templated as /user/{id}
      const pathItem = spec.paths?.["/user/{id}"];
      expect(pathItem).toBeTruthy();
      const op = pathItem?.get;
      expect(op).toBeTruthy();

      // Meta should map to summary/description
      expect(op.summary).toBe("Get User By ID");
      expect(op.description).toMatch(/single user/i);

      // Params should include required path param `id`
      const params = op.parameters || [];
      const idParam = params.find((p: any) => p.name === "id" && p.in === "path");
      expect(idParam).toBeTruthy();
      expect(idParam.required).toBe(true);
      expect(idParam.schema?.type).toBe("string");
    } finally {
      await rr.dispose();
    }
  });
});
