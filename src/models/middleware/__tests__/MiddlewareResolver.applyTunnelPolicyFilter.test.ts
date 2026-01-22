import { MiddlewareResolver } from "../MiddlewareResolver";
import { taskNotRegisteredError } from "../../../errors";

describe("MiddlewareResolver.applyTunnelPolicyFilter", () => {
  test("throws when task is not registered", () => {
    const store: any = {
      tasks: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
    };

    const resolver = new MiddlewareResolver(store);
    const task: any = { id: "unregistered", middleware: [] };

    expect(() => resolver.applyTunnelPolicyFilter(task, [])).toThrow(
      /Task "unregistered" is not registered/,
    );
  });
});
