import {
  symbolEvent,
  symbolOptionalDependency,
  symbolResource,
  symbolTask,
} from "../../defs";
import { getAllThrows } from "../../tools/getAllThrows";

describe("getAllThrows branch coverage", () => {
  it("covers dependency function/optional traversal and middleware predicates", () => {
    const depResource = {
      id: "cov.getAllThrows.depResource",
      [symbolResource]: true,
      throws: ["cov.dep.throw"],
      middleware: [],
      dependencies: undefined,
    };

    const optionalDep = {
      [symbolOptionalDependency]: true,
      inner: depResource,
    };

    const event = {
      id: "cov.getAllThrows.event",
      [symbolEvent]: true,
    };

    const targetTask = {
      id: "cov.getAllThrows.task",
      [symbolTask]: true,
      throws: ["cov.task.throw"],
      middleware: [],
      dependencies: () => ({
        event,
        depA: optionalDep,
        depB: depResource,
        depNull: null,
      }),
    };

    const registry = {
      taskMiddlewares: new Map([
        [
          "cov.mw.skipNoEverywhere",
          { middleware: { id: "cov.mw.skipNoEverywhere", throws: ["x"] } },
        ],
        [
          "cov.mw.skipFalse",
          {
            middleware: {
              id: "cov.mw.skipFalse",
              everywhere: () => false,
              throws: ["x"],
            },
          },
        ],
        [
          "cov.mw.collectTrue",
          {
            middleware: {
              id: "cov.mw.collectTrue",
              everywhere: () => true,
              throws: ["cov.task.mw.throw"],
            },
          },
        ],
      ]),
      resourceMiddlewares: new Map(),
      hooks: new Map([
        [
          "cov.hook.onArray",
          {
            hook: {
              on: [{ id: "cov.getAllThrows.event" }],
              throws: ["cov.hook.throw"],
            },
          },
        ],
      ]),
    };

    const result = getAllThrows(registry as any, targetTask as any);
    expect(result).toEqual([
      "cov.task.throw",
      "cov.task.mw.throw",
      "cov.dep.throw",
      "cov.hook.throw",
    ]);
  });

  it("covers resource target with undefined middleware/deps and local middleware skip", () => {
    const targetResource = {
      id: "cov.getAllThrows.resource",
      [symbolResource]: true,
      throws: ["cov.resource.throw"],
      middleware: [{ id: "cov.res.mw.local", throws: ["cov.res.local.throw"] }],
      dependencies: undefined,
    };

    const registry = {
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map([
        [
          "cov.res.mw.local",
          {
            middleware: {
              id: "cov.res.mw.local",
              everywhere: true,
              throws: ["cov.res.global.duplicate"],
            },
          },
        ],
      ]),
      hooks: new Map(),
    };

    const result = getAllThrows(registry as any, targetResource as any);
    expect(result).toEqual(["cov.resource.throw", "cov.res.local.throw"]);
  });

  it("handles task/resource mocks with empty middleware", () => {
    const registry = {
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
    };

    const taskWithEmptyMiddleware = {
      id: "cov.getAllThrows.task.no-middleware",
      [symbolTask]: true,
      throws: ["cov.no-middleware.task.throw"],
      middleware: [],
      dependencies: {},
    };
    expect(
      getAllThrows(registry as any, taskWithEmptyMiddleware as any),
    ).toEqual(["cov.no-middleware.task.throw"]);

    const resourceWithEmptyMiddleware = {
      id: "cov.getAllThrows.resource.no-middleware",
      [symbolResource]: true,
      throws: ["cov.no-middleware.resource.throw"],
      middleware: [],
      dependencies: undefined,
    };
    expect(
      getAllThrows(registry as any, resourceWithEmptyMiddleware as any),
    ).toEqual(["cov.no-middleware.resource.throw"]);
  });

  it("covers direct middleware iteration when arrays are present", () => {
    const registry = {
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
    };

    const taskWithMiddleware = {
      id: "cov.getAllThrows.task.with-middleware",
      [symbolTask]: true,
      throws: [],
      middleware: [
        { id: "cov.local.task.mw", throws: ["cov.local.task.throw"] },
      ],
      dependencies: {},
    };
    expect(getAllThrows(registry as any, taskWithMiddleware as any)).toEqual([
      "cov.local.task.throw",
    ]);

    const resourceWithMiddleware = {
      id: "cov.getAllThrows.resource.with-middleware",
      [symbolResource]: true,
      throws: [],
      middleware: [
        { id: "cov.local.resource.mw", throws: ["cov.local.resource.throw"] },
      ],
      dependencies: undefined,
    };
    expect(
      getAllThrows(registry as any, resourceWithMiddleware as any),
    ).toEqual(["cov.local.resource.throw"]);
  });
});
