import { r, globals } from "@bluelibs/runner";
import { db } from "./db.resource";
import { User } from "./entities/user.entity";
import { Post } from "./entities/post.entity";
import { randomUUID } from "crypto";
import { auth as authResource } from "#/users/resources/auth.resource";

export const fixtures = r
  .resource("app.db.resources.fixtures")
  .meta({
    title: "Database Fixtures",
    description:
      "Seed initial user and post data for development and testing environments",
  })
  .dependencies({ db, logger: globals.resources.logger, auth: authResource })
  .init(async (_, { db, logger, auth }) => {
    const em = db.em();

    // Only seed when there are no users
    try {
      const userCount = await em.count(User, {});
      if (userCount > 0) {
        logger.info("Fixtures: users already present, skipping seeding");
        return true;
      }
    } catch (err) {
      // If the users table doesn't exist yet (no migrations run), skip silently.
      logger.warn(
        "Fixtures: could not check users count (are migrations applied?) — skipping seeding",
      );
      return false;
    }

    logger.info("Fixtures: seeding initial users and posts");

    // Default password for seeded users: "password"
    const seededUsersData = [
      { name: "Ada Lovelace", email: "ada@example.test" },
      { name: "Alan Turing", email: "alan@example.test" },
      { name: "Grace Hopper", email: "grace@example.test" },
    ];

    const users = [] as User[];
    for (const u of seededUsersData) {
      const { hash, salt } = await auth.hashPassword("password");
      const user = em.create(User, {
        id: randomUUID(),
        ...u,
        passwordHash: hash,
        passwordSalt: salt,
      });
      users.push(user);
    }

    users.forEach((u) => em.persist(u));

    const postsData: Array<{ title: string; content: string; author: User }> = [
      {
        title: "Computing Poetry",
        content: "Numbers can compose.",
        author: users[0],
      },
      {
        title: "Analytical Engine",
        content: "A vision becomes code.",
        author: users[0],
      },
      {
        title: "Decision Problems",
        content: "On computability.",
        author: users[1],
      },
      {
        title: "Machine Intelligence",
        content: "Can machines think?",
        author: users[1],
      },
      {
        title: "COBOL Musings",
        content: "Readable business code.",
        author: users[2],
      },
      {
        title: "Compilers",
        content: "Bringing code to life.",
        author: users[2],
      },
    ];

    const posts = postsData.map((p) =>
      em.create(Post, {
        id: randomUUID(),
        title: p.title,
        content: p.content,
        author: p.author,
      }),
    );
    posts.forEach((p) => em.persist(p));

    await em.flush();

    logger.info(
      `Fixtures: seeded ${users.length} users and ${posts.length} posts successfully`,
    );

    return true;
  })
  .build();
