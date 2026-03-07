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
    expect(built.subtree?.tasks?.middleware).toHaveLength(1);
    const firstMiddleware = built.subtree?.tasks?.middleware?.[0];
    expect(firstMiddleware).toBeDefined();
    if (!firstMiddleware) {
      return;
    }
    expect(getSubtreeTaskMiddlewareAttachment(firstMiddleware).id).toBe(
      taskMiddleware.id,
    );
  });
});
