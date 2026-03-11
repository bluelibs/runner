import { r } from "../..";
import { getSubtreeTaskMiddlewareAttachment } from "../../tools/subtreeMiddleware";

describe("resource builder subtree()", () => {
  it("applies subtree policy and keeps chaining", () => {
    const taskMiddleware = r.middleware
      .task("tests-resourceSubtreeBuilder-taskMiddleware")
      .run(async ({ next, task }) => next(task.input))
      .build();

    const built = r
      .resource("tests-resourceSubtreeBuilder-resource")
      .subtree({
        tasks: {
          middleware: [taskMiddleware],
        },
      })
      .init(async () => "ok")
      .build();

    expect(built.subtree).toBeDefined();
    if (!built.subtree || typeof built.subtree === "function") {
      throw new Error("Expected a static subtree policy.");
    }

    expect(built.subtree.tasks?.middleware).toHaveLength(1);
    const firstMiddleware = built.subtree.tasks?.middleware?.[0];
    expect(firstMiddleware).toBeDefined();
    if (!firstMiddleware) {
      return;
    }
    expect(getSubtreeTaskMiddlewareAttachment(firstMiddleware).id).toBe(
      taskMiddleware.id,
    );
  });

  it("supports config-driven subtree declarations", () => {
    const built = r
      .resource<{ enabled: boolean }>("tests-resourceSubtreeBuilder-dynamic")
      .subtree((config) => ({
        validate: config.enabled ? [() => []] : [],
      }))
      .init(async () => "ok")
      .build();

    expect(typeof built.subtree).toBe("function");
    if (typeof built.subtree !== "function") {
      return;
    }

    expect(built.subtree({ enabled: true })).toEqual({
      validate: [expect.any(Function)],
    });
    expect(built.subtree({ enabled: false })).toEqual({
      validate: [],
    });
  });
});
