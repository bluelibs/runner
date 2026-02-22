import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { globalTags } from "../../../globals/globalTags";

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

  test("applies object-style client middleware allow list", () => {
    const task: any = { id: "registered", middleware: [], isTunneled: true };
    const store: any = {
      tasks: new Map([["registered", { task }]]),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
    };
    const resolver = new MiddlewareResolver(store);
    const middlewares = [{ id: "mw.a" }, { id: "mw.b" }] as any[];

    const existsSpy = jest
      .spyOn(globalTags.tunnelTaskPolicy, "exists")
      .mockReturnValue(true);
    const extractSpy = jest
      .spyOn(globalTags.tunnelTaskPolicy, "extract")
      .mockReturnValue({
        client: { middlewareAllowList: ["mw.a"] },
      } as any);

    try {
      expect(resolver.applyTunnelPolicyFilter(task, middlewares)).toEqual([
        { id: "mw.a" },
      ]);
    } finally {
      existsSpy.mockRestore();
      extractSpy.mockRestore();
    }
  });

  test("falls back to grouped allow list when client object has no middlewareAllowList", () => {
    const task: any = {
      id: "registered.grouped",
      middleware: [],
      isTunneled: true,
    };
    const store: any = {
      tasks: new Map([["registered.grouped", { task }]]),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
    };
    const resolver = new MiddlewareResolver(store);
    const middlewares = [{ id: "mw.keep" }, { id: "mw.drop" }] as any[];

    const existsSpy = jest
      .spyOn(globalTags.tunnelTaskPolicy, "exists")
      .mockReturnValue(true);
    const extractSpy = jest
      .spyOn(globalTags.tunnelTaskPolicy, "extract")
      .mockReturnValue({
        client: {},
        middlewareAllowList: { client: ["mw.keep"] },
      } as any);

    try {
      expect(resolver.applyTunnelPolicyFilter(task, middlewares)).toEqual([
        { id: "mw.keep" },
      ]);
    } finally {
      existsSpy.mockRestore();
      extractSpy.mockRestore();
    }
  });
});
