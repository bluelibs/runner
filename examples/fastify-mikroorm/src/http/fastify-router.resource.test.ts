import { buildTestRunner } from "../test/utils";
import { fastify } from "./resources/fastify.resource";
import { fastifyRouter } from "./resources/fastify-router.resource";
import { listAllUsers } from "../users/tasks/list-all-users.task";
import { authorize } from "./middleware/authorize.middleware";
import { auth as authResource } from "../users/resources/auth.resource";
import { httpRoute } from "./tags";
import { db } from "../db/resources/db.resource";
import { testOrmConfig } from "../test/utils";

describe("fastify router", () => {
  it("registers routes from tagged tasks", async () => {
    const rr = await buildTestRunner({
      register: [
        httpRoute,
        fastify,
        fastifyRouter,
        authResource,
        db,
        authorize,
        listAllUsers,
      ],
      overrides: [testOrmConfig],
    });

    try {
      const f = rr.getResourceValue(fastify);
      const routes = f.printRoutes();
      expect(routes).toContain("users (GET");
    } finally {
      await rr.dispose();
    }
  });
});
