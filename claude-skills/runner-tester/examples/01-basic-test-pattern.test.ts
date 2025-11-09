/**
 * Basic Testing Pattern
 *
 * Demonstrates:
 * - Setting up a test with mocked dependencies
 * - Running tasks in tests
 * - Assertions
 * - Proper cleanup with dispose()
 */

import { r, run } from "@bluelibs/runner";

describe("Basic Testing Pattern", () => {
  it("should test a task with mocked dependencies", async () => {
    // 1. Create mocks
    const mockDb = {
      users: {
        create: jest.fn().mockResolvedValue({ id: "123", name: "Ada" }),
      },
    };

    // 2. Build app with mocked resource
    const db = r
      .resource("db")
      .init(async () => mockDb)
      .build();

    const createUser = r
      .task("createUser")
      .inputSchema<{ name: string }>({ parse: (v) => v })
      .dependencies({ db })
      .run(async (input, { db }) => {
        return await db.users.create(input);
      })
      .build();

    const app = r
      .resource("test.app")
      .register([db, createUser])
      .build();

    // 3. Run and assert
    const { runTask, dispose } = await run(app);
    const result = await runTask(createUser, { name: "Ada" });

    expect(result).toEqual({ id: "123", name: "Ada" });
    expect(mockDb.users.create).toHaveBeenCalledWith({ name: "Ada" });
    expect(mockDb.users.create).toHaveBeenCalledTimes(1);

    // 4. Always dispose
    await dispose();
  });

  it("should test error handling", async () => {
    const mockDb = {
      users: {
        create: jest.fn().mockRejectedValue(new Error("DB error")),
      },
    };

    const db = r
      .resource("db")
      .init(async () => mockDb)
      .build();

    const createUser = r
      .task("createUser")
      .dependencies({ db })
      .run(async (input: { name: string }, { db }) => {
        return await db.users.create(input);
      })
      .build();

    const app = r
      .resource("test.app")
      .register([db, createUser])
      .build();

    const { runTask, dispose } = await run(app);

    await expect(runTask(createUser, { name: "Ada" })).rejects.toThrow(
      "DB error"
    );

    await dispose();
  });
});
