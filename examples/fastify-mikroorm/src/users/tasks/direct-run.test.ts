import { buildTestRunner, testOrmConfig } from "../../test/utils";
import { db } from "../../db/resources/db.resource";
import { users } from "../index";
import { fastifyContext } from "../../http/fastify-context";
import { loginUser } from "./login.task";
import { currentUser } from "./me.task";
import { httpRoute } from "../../http/tags";

describe("direct task runs (without router)", () => {
  it("login sets cookie via fastifyContext reply", async () => {
    const rr = await buildTestRunner({ register: [httpRoute, db, users], overrides: [testOrmConfig] });
    try {
      const { orm, em } = rr.getResourceValue(db);
      await orm.getSchemaGenerator().createSchema();
      const email = "d1@example.test";
      const name = "D One";
      const password = "p@ssw0rd";

      // Create user via HTTP task to ensure proper hashing
      const { registerUser } = require("./register.task");
      const reply = { header: jest.fn() } as any;
      await fastifyContext.provide({ request: {} as any, reply, requestId: "x", user: null, userId: null, logger: {} }, async () => {
        await rr.runTask(registerUser, { name, email, password });
      });

      // Now login and ensure Set-Cookie set
      const reply2 = { header: jest.fn() } as any;
      await fastifyContext.provide({ request: {} as any, reply: reply2, requestId: "x2", user: null, userId: null, logger: {} }, async () => {
        const res = await rr.runTask(loginUser, { email, password });
        expect(res!.token).toBeTruthy();
      });
      expect(reply2.header).toHaveBeenCalled();
    } finally {
      await rr.dispose();
    }
  });

  it("me task throws 401 when context has unknown user", async () => {
    const rr = await buildTestRunner({ register: [httpRoute, db, users], overrides: [testOrmConfig] });
    try {
      const { orm } = rr.getResourceValue(db);
      await orm.getSchemaGenerator().createSchema();
      const reply = { header: jest.fn() } as any;
      await expect(
        fastifyContext.provide({ request: {} as any, reply, requestId: "id", user: { id: "missing", name: "", email: "" }, userId: "missing", logger: {} }, async () => {
          return rr.runTask(currentUser);
        }),
      ).rejects.toThrow();
    } finally {
      await rr.dispose();
    }
  });
});
