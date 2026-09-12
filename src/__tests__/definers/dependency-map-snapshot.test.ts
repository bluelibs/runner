import { r, run } from "../..";

describe("dependency map snapshots after factories", () => {
  const original = r
    .resource("original")
    .init(async () => 1)
    .build();
  const replacement = r
    .resource("replacement")
    .init(async () => 2)
    .build();

  it("snapshots task dependency additions when declared", async () => {
    const dependencies = { selected: original };
    const task = r
      .task("read")
      .dependencies(() => ({}))
      .dependencies(dependencies)
      .run(async (_, { selected }) => selected)
      .build();
    dependencies.selected = replacement;
    const runtime = await run(
      r.resource("app").register([original, replacement, task]).build(),
    );
    try {
      expect(await runtime.runTask(task)).toBe(1);
      expect(Object.isFrozen(dependencies)).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("snapshots config-aware dependency additions when declared", async () => {
    const dependencies = { selected: original };
    const app = r
      .resource("app")
      .register([original, replacement])
      .dependencies(() => ({}))
      .dependencies(dependencies)
      .init(async (_, { selected }) => selected)
      .build();
    dependencies.selected = replacement;
    const runtime = await run(app);
    try {
      expect(runtime.value).toBe(1);
      expect(Object.isFrozen(dependencies)).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
});
