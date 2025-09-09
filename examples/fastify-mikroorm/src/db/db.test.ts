import { buildTestRunner, testOrmConfig } from "#/general/test/utils";
import { db } from "./resources/db.resource";
import { User } from "./resources/entities/user.entity";
import { Post } from "./resources/entities/post.entity";

describe("db (sqlite in-memory)", () => {
  it("creates schema, inserts and queries relations", async () => {
    const rr = await buildTestRunner({
      register: [db],
      overrides: [testOrmConfig],
    });
    try {
      const dbRes = rr.getResourceValue(db);
      await dbRes.orm.getSchemaGenerator().createSchema();

      const em = dbRes.em();

      const user = em.create(User, {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Ada",
        email: "ada@example.test",
      });
      await em.persistAndFlush(user);

      const post = em.create(Post, {
        id: "22222222-2222-2222-2222-222222222222",
        title: "Hello",
        content: "World",
        author: user,
      });
      await em.persistAndFlush(post);

      const posts = await em.find(Post, {}, { populate: ["author"] });
      expect(posts).toHaveLength(1);
      expect(posts[0].author?.name).toBe("Ada");
    } finally {
      await rr.dispose();
    }
  });
});
