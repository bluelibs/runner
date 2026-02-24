import {
  symbolEvent,
  symbolOptionalDependency,
  symbolResource,
  symbolTask,
} from "../../defs";
import { getAllThrows } from "../../tools/getAllThrows";

describe("getAllThrows branch coverage", () => {
  it("covers dependency function/optional traversal and subtree task middleware", () => {
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

    const taskSubtreeMiddleware = {
      id: "cov.subtree.task.middleware",
      throws: ["cov.task.mw.throw"],
    };

    const ownerResource = {
      id: "cov.owner.resource",
      [symbolResource]: true,
      middleware: [],
      dependencies: undefined,
      subtree: {
        tasks: {
          middleware: [taskSubtreeMiddleware],
          validate: [],
        },
      },
    };

    const ownerMap = new Map<string, string>([
      [targetTask.id, ownerResource.id],
      [taskSubtreeMiddleware.id, ownerResource.id],
    ]);

    const registry = {
      tasks: new Map(),
      taskMiddlewares: new Map(),
      resources: new Map([[ownerResource.id, { resource: ownerResource }]]),
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
      visibilityTracker: {
        getOwnerResourceId: (itemId: string) => ownerMap.get(itemId),
      },
    };

    const result = getAllThrows(registry as any, targetTask as any);
    expect(result).toEqual([
      "cov.task.throw",
      "cov.task.mw.throw",
      "cov.dep.throw",
      "cov.hook.throw",
    ]);
  });

  it("covers resource target with undefined deps and local middleware dedupe over subtree middleware", () => {
    const localMiddleware = {
      id: "cov.res.mw.local",
      throws: ["cov.res.local.throw"],
    };

    const subtreeDuplicate = {
      id: "cov.res.mw.local",
      throws: ["cov.res.global.duplicate"],
    };

    const targetResource = {
      id: "cov.getAllThrows.resource",
      [symbolResource]: true,
      throws: ["cov.resource.throw"],
      middleware: [localMiddleware],
      dependencies: undefined,
    };

    const ownerResource = {
      id: "cov.owner.resource",
      [symbolResource]: true,
      middleware: [],
      dependencies: undefined,
      subtree: {
        resources: {
          middleware: [subtreeDuplicate],
          validate: [],
        },
      },
    };

    const ownerMap = new Map<string, string>([
      [targetResource.id, ownerResource.id],
    ]);

    const registry = {
      taskMiddlewares: new Map(),
      resources: new Map([[ownerResource.id, { resource: ownerResource }]]),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker: {
        getOwnerResourceId: (itemId: string) => ownerMap.get(itemId),
      },
    };

    const result = getAllThrows(registry as any, targetResource as any);
    expect(result).toEqual(["cov.resource.throw", "cov.res.local.throw"]);
  });

  it("handles task/resource mocks with empty middleware", () => {
    const registry = {
      taskMiddlewares: new Map(),
      resources: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker: {
        getOwnerResourceId: () => undefined,
      },
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
      resources: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker: {
        getOwnerResourceId: () => undefined,
      },
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
      resources: new Map(),
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
      visibilityTracker: {
        getOwnerResourceId: () => undefined,
      },
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
      resources: new Map(),
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
      visibilityTracker: {
        getOwnerResourceId: () => undefined,
      },
    };

    expect(getAllThrows(registry as any, task as any)).toEqual([]);
  });

  it("covers subtree task middleware branch when owner is missing", () => {
    const task = {
      id: "cov.getAllThrows.task.subtree.owner-missing",
      [symbolTask]: true,
      throws: [],
      middleware: [],
      dependencies: {},
    };

    const registry = {
      taskMiddlewares: new Map(),
      resources: new Map([
        [
          "cov.owner.resource",
          {
            resource: {
              id: "cov.owner.resource",
              [symbolResource]: true,
              middleware: [],
              dependencies: undefined,
              subtree: {
                tasks: {
                  middleware: [
                    {
                      id: "cov.subtree.task.middleware",
                      throws: ["cov.subtree.task.throw"],
                    },
                  ],
                  validate: [],
                },
              },
            },
          },
        ],
      ]),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker: {
        getOwnerResourceId: () => undefined,
      },
    };

    expect(getAllThrows(registry as any, task as any)).toEqual([]);
  });

  it("skips subtree task middleware when local middleware uses the same id", () => {
    const localTaskMiddleware = {
      id: "cov.task.local.same-id",
      throws: ["cov.task.local.same-id.throw"],
    };

    const task = {
      id: "cov.getAllThrows.task.subtree.same-id",
      [symbolTask]: true,
      throws: [],
      middleware: [localTaskMiddleware],
      dependencies: undefined,
    };

    const ownerResource = {
      id: "cov.getAllThrows.task.subtree.owner",
      [symbolResource]: true,
      middleware: [],
      dependencies: undefined,
      subtree: {
        tasks: {
          middleware: [{ id: localTaskMiddleware.id, throws: ["ignored"] }],
          validate: [],
        },
      },
    };

    const registry = {
      taskMiddlewares: new Map(),
      resources: new Map([[ownerResource.id, { resource: ownerResource }]]),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker: {
        getOwnerResourceId: (itemId: string) =>
          itemId === task.id ? ownerResource.id : undefined,
      },
    };

    expect(getAllThrows(registry as any, task as any)).toEqual([
      "cov.task.local.same-id.throw",
    ]);
  });

  it("handles tasks with undefined dependencies without collecting hook throws", () => {
    const task = {
      id: "cov.getAllThrows.task.undefined-deps",
      [symbolTask]: true,
      throws: ["cov.undefined.deps.throw"],
      middleware: [],
      dependencies: undefined,
    };

    const registry = {
      taskMiddlewares: new Map(),
      resources: new Map(),
      resourceMiddlewares: new Map(),
      hooks: new Map([
        [
          "cov.undefined.deps.hook",
          {
            hook: {
              on: [{ id: "cov.undefined.deps.event" }],
              throws: ["cov.undefined.deps.hook.throw"],
            },
          },
        ],
      ]),
      visibilityTracker: {
        getOwnerResourceId: () => undefined,
      },
    };

    expect(getAllThrows(registry as any, task as any)).toEqual([
      "cov.undefined.deps.throw",
    ]);
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
      resources: new Map([
        [
          "cov.owner.resource",
          {
            resource: {
              id: "cov.owner.resource",
              [symbolResource]: true,
              middleware: [],
              dependencies: undefined,
              subtree: {
                resources: {
                  middleware: [
                    {
                      id: "cov.subtree.resource.middleware",
                      throws: ["cov.subtree.resource.throw"],
                    },
                  ],
                  validate: [],
                },
              },
            },
          },
        ],
      ]),
      resourceMiddlewares: new Map(),
      hooks: new Map(),
      visibilityTracker: {
        getOwnerResourceId: () => undefined,
      },
    };

    expect(getAllThrows(registry as any, resource as any)).toEqual([]);
  });
});
