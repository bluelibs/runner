import { defineResource } from "../../define";
import { run } from "../../run";

describe("run behavioral scenarios", () => {
  it("should ensure parallel run() isolation", async () => {
    // We'll use a resource that increments a counter in a shared object
    // to see if they bleed.
    const shared = { counter: 0 };

    const isolatedResource = (id: string) =>
      defineResource({
        id: `isolated.${id}`,
        async init() {
          shared.counter++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return id;
        },
      });

    const [run1, run2] = await Promise.all([
      run(isolatedResource("1")),
      run(isolatedResource("2")),
    ]);

    expect(run1.value).toBe("1");
    expect(run2.value).toBe("2");
    expect(shared.counter).toBe(2);

    await run1.dispose();
    await run2.dispose();
  });

  it("should handle disposal failure cascading", async () => {
    const order: string[] = [];

    const badResource = defineResource({
      id: "bad",
      init: async () => "bad",
      dispose: async () => {
        order.push("bad");
        throw new Error("Disposal failed");
      },
    });

    const goodResource = defineResource({
      id: "good",
      init: async () => "good",
      dispose: async () => {
        order.push("good");
      },
    });

    const app = defineResource({
      id: "app",
      register: [badResource, goodResource],
      async init() {},
    });

    const result = await run(app);

    // Even if one fails, others should be attempted.
    // The runner should collect errors and throw them together or just throw the first one?
    // Based on current implementation, it tries all and then throws a combined error if supported or just the first.
    await expect(result.dispose()).rejects.toThrow("Disposal failed");

    expect(order).toContain("bad");
    expect(order).toContain("good");
  });

  it("should handle empty dynamic register return values", async () => {
    const app = defineResource({
      id: "app",
      register: () => [], // Empty return
      async init() {
        return "ok";
      },
    });

    const result = await run(app);
    expect(result.value).toBe("ok");
    await result.dispose();
  });

  it("should handle null dynamic register return values", async () => {
    const app = defineResource({
      id: "app",
      register: (() => null) as any, // Null return
      async init() {
        return "ok";
      },
    });

    const result = await run(app);
    expect(result.value).toBe("ok");
    await result.dispose();
  });
});
