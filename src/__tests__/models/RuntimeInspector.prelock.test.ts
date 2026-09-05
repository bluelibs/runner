import {
  defineResource,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { RuntimeInspector } from "../../models/runtime-inspector/RuntimeInspector";
import { identityCheckerTaskMiddleware } from "../../globals/middleware/identityChecker.middleware";
import { createTestFixture } from "../test-utils";

describe("RuntimeInspector before Store lock", () => {
  it("returns detached snapshots and marks unresolved dependency factories", () => {
    const { store } = createTestFixture();
    const looseTask = defineTask({
      id: "loose-task",
      dependencies: () => ({}),
      run: async () => undefined,
    });
    const missingResource = defineResource({ id: "missing-resource" });
    const looseTaskWithUnknownReferences = defineTask({
      id: "loose-task-with-unknown-references",
      dependencies: { missingResource: missingResource.optional() },
      middleware: [
        defineTaskMiddleware({
          id: "missing-middleware",
          run: async ({ next }) => next(),
        }),
      ],
      tags: [defineTag({ id: "missing-tag" })],
      run: async () => undefined,
    });
    const routedLooseTask = {
      ...defineTask({
        id: "routed-loose-task",
        middleware: [
          defineTaskMiddleware({
            id: "filtered-middleware",
            run: async ({ next }) => next(),
          }),
          identityCheckerTaskMiddleware,
        ],
        run: async () => undefined,
      }),
      isRpcRouted: true,
    };
    store.tasks.set(looseTask.id, {
      task: looseTask,
      computedDependencies: {},
      isInitialized: false,
    });
    store.tasks.set(looseTaskWithUnknownReferences.id, {
      task: looseTaskWithUnknownReferences,
      computedDependencies: {},
      isInitialized: false,
    });
    store.tasks.set(routedLooseTask.id, {
      task: routedLooseTask,
      computedDependencies: {},
      isInitialized: false,
    });
    const inspector = new RuntimeInspector(store);

    const first = inspector.snapshot();
    const second = inspector.snapshot();

    expect(first).not.toBe(second);
    expect(first.rootId).toBeUndefined();
    expect(first.lifecycle).toEqual({ readyWaves: [], shutdownWaves: [] });
    expect(first.definitions).toEqual([
      {
        kind: "task",
        canonicalId: "loose-task",
        sourceId: undefined,
        ownerId: undefined,
        dependenciesResolved: false,
        dependencies: [],
        middleware: [],
        tagIds: [],
        override: undefined,
        rootAccess: undefined,
      },
      {
        kind: "task",
        canonicalId: "loose-task-with-unknown-references",
        sourceId: undefined,
        ownerId: undefined,
        dependenciesResolved: true,
        dependencies: [],
        middleware: [
          {
            id: "missing-middleware",
            order: 0,
            origin: "local",
            sourceId: "loose-task-with-unknown-references",
          },
        ],
        tagIds: [],
        override: undefined,
        rootAccess: undefined,
      },
      {
        kind: "task",
        canonicalId: "routed-loose-task",
        sourceId: undefined,
        ownerId: undefined,
        dependenciesResolved: true,
        dependencies: [],
        middleware: [
          {
            id: "identityChecker",
            order: 0,
            origin: "local",
            sourceId: "routed-loose-task",
          },
        ],
        tagIds: [],
        override: undefined,
        rootAccess: undefined,
      },
    ]);
  });
});
