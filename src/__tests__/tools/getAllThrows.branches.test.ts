import {
  symbolEvent,
  symbolOptionalDependency,
  symbolResource,
  symbolTask,
} from "../../defs";
import { getAllThrows } from "../../tools/getAllThrows";

const visibilityTracker = {
  isAccessible: () => true,
  getOwnerResourceId: () => "cov.owner.resource",
  isWithinResourceSubtree: () => true,
};

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
          "cov.mw.skipNoApplyTo",
          { middleware: { id: "cov.mw.skipNoApplyTo", throws: ["x"] } },
        ],
        [
          "cov.mw.skipFalse",
          {
            middleware: {
              id: "cov.mw.skipFalse",
              throws: ["x"],
            },
            applyTo: { scope: "where-visible" as const, when: () => false },
          },
        ],
        [
          "cov.mw.collectTrue",
          {
            middleware: {
              id: "cov.mw.collectTrue",
              throws: ["cov.task.mw.throw"],
            },
            applyTo: { scope: "where-visible" as const, when: () => true },
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
      visibilityTracker,
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
              throws: ["cov.res.global.duplicate"],
            },
            applyTo: { scope: "where-visible" as const },
          },
        ],
      ]),
      hooks: new Map(),
      visibilityTracker,
    };

    const result = getAllThrows(registry as any, targetResource as any);
    expect(result).toEqual(["cov.resource.throw", "cov.res.local.throw"]);
  });

  it("handles task/resource mocks with empty middleware", () => {
    const registry = {
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker,
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
      visibilityTracker,
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

  it("returns empty for non-task/non-resource targets and ignores unrelated hooks", () => {
    const registry = {
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map([
        [
          "cov.hook.unrelated",
          {
            hook: {
              on: [{ id: "cov.event.other" }],
              throws: ["cov.unrelated.throw"],
            },
          },
        ],
      ]),
      visibilityTracker,
    };

    expect(getAllThrows(registry as any, { id: "cov.other" } as any)).toEqual(
      [],
    );
  });

  it("does not collect hook throws when task emits unrelated events", () => {
    const event = {
      id: "cov.getAllThrows.event.unrelated.source",
      [symbolEvent]: true,
    };

    const task = {
      id: "cov.getAllThrows.task.unrelated.hook",
      [symbolTask]: true,
      throws: [],
      middleware: [],
      dependencies: { event },
    };

    const registry = {
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map([
        [
          "cov.hook.unrelated.array",
          {
            hook: {
              on: [{ id: "cov.getAllThrows.event.other" }],
              throws: ["cov.should.not.collect"],
            },
          },
        ],
      ]),
      visibilityTracker,
    };

    expect(getAllThrows(registry as any, task as any)).toEqual([]);
  });

  it("covers subtree middleware branch when owner is missing", () => {
    const task = {
      id: "cov.getAllThrows.task.subtree.owner-missing",
      [symbolTask]: true,
      throws: [],
      middleware: [],
      dependencies: {},
    };

    const registry = {
      taskMiddlewares: new Map([
        [
          "cov.subtree.task.middleware",
          {
            middleware: {
              id: "cov.subtree.task.middleware",
              throws: ["cov.subtree.task.throw"],
            },
            applyTo: { scope: "subtree" as const },
          },
        ],
      ]),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker: {
        isAccessible: () => true,
        getOwnerResourceId: () => undefined,
        isWithinResourceSubtree: () => false,
      },
    };

    expect(getAllThrows(registry as any, task as any)).toEqual([]);
  });

  it("covers subtree resource middleware branch when owner is missing", () => {
    const resource = {
      id: "cov.getAllThrows.resource.subtree.owner-missing",
      [symbolResource]: true,
      throws: [],
      middleware: [],
      dependencies: undefined,
    };

    const registry = {
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map([
        [
          "cov.subtree.resource.middleware",
          {
            middleware: {
              id: "cov.subtree.resource.middleware",
              throws: ["cov.subtree.resource.throw"],
            },
            applyTo: { scope: "subtree" as const },
          },
        ],
      ]),
      hooks: new Map(),
      visibilityTracker: {
        isAccessible: () => true,
        getOwnerResourceId: () => undefined,
        isWithinResourceSubtree: () => false,
      },
    };

    expect(getAllThrows(registry as any, resource as any)).toEqual([]);
  });
});
