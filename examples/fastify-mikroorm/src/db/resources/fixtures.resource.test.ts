import { buildTestRunner, testOrmConfig } from "../../test/utils";
import { db } from "./db.resource";
import { fixtures } from "./fixtures.resource";
import { auth as authResource } from "../../users/resources/auth.resource";
import { User } from "./entities/user.entity";
import { Post } from "./entities/post.entity";

describe("fixtures resource", () => {
  it("returns false and warns when schema is missing", async () => {
    const rr = await buildTestRunner({ register: [db, authResource], overrides: [testOrmConfig] });
    try {
      const logger = { info: jest.fn(), warn: jest.fn() } as const;
      const dbRes = rr.getResourceValue(db);
      const auth = rr.getResourceValue(authResource);

      const result = await (fixtures as any).init(undefined, { db: dbRes, logger, auth });
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      await rr.dispose();
    }
  });

  it("seeds users and posts when empty, and is idempotent", async () => {
    const rr = await buildTestRunner({ register: [db, authResource], overrides: [testOrmConfig] });
    try {
      const logger = { info: jest.fn(), warn: jest.fn() } as const;
      const dbRes = rr.getResourceValue(db);
      const auth = rr.getResourceValue(authResource);

      // Ensure schema exists so seeding can run
      await dbRes.orm.getSchemaGenerator().createSchema();

      // First run seeds data
      const seeded = await (fixtures as any).init(undefined, { db: dbRes, logger, auth });
      expect(seeded).toBe(true);

      const em = dbRes.em();
      const users = await em.find(User, {});
      const posts = await em.find(Post, {}, { populate: ["author"] });
      expect(users).toHaveLength(3);
      expect(posts).toHaveLength(6);
      // Seeded users have hashed passwords
      for (const u of users) {
        expect(u.passwordHash).toBeTruthy();
        expect(u.passwordSalt).toBeTruthy();
      }

      // Second run should skip (idempotent) and not add duplicates
      const skipped = await (fixtures as any).init(undefined, { db: dbRes, logger, auth });
      expect(skipped).toBe(true);
      const usersAfter = await em.find(User, {});
      const postsAfter = await em.find(Post, {});
      expect(usersAfter).toHaveLength(3);
      expect(postsAfter).toHaveLength(6);
    } finally {
      await rr.dispose();
    }
  });
});

