import {
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { VisibilityTracker } from "../../models/VisibilityTracker";
import { scope } from "../../public";
import { createVisibilityRegistry } from "./visibilityTrackerTestUtils";

describe("VisibilityTracker validation", () => {
  let tracker: VisibilityTracker;

  beforeEach(() => {
    tracker = new VisibilityTracker();
  });

  describe("subtree middleware visibility checks", () => {
    it("throws when subtree task middleware is not visible to the policy owner", () => {
      const hiddenOwner = defineResource({
        id: "tracker-subtree-hidden-owner-task",
      });
      const policyOwner = defineResource({
        id: "tracker-subtree-policy-owner-task",
      });
      const hiddenTaskMiddleware = defineTaskMiddleware({
        id: "tracker-subtree-hidden-task-middleware",
        run: async ({ next, task }) => next(task.input),
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", hiddenOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(hiddenOwner.id, hiddenTaskMiddleware);
      tracker.recordExports(hiddenOwner.id, []);

      const registry = createVisibilityRegistry({
        taskMiddlewares: new Map([
          [hiddenTaskMiddleware.id, { middleware: hiddenTaskMiddleware }],
        ]),
        resources: new Map([
          [hiddenOwner.id, { resource: hiddenOwner }],
          [
            policyOwner.id,
            {
              resource: {
                ...policyOwner,
                subtree: {
                  tasks: {
                    middleware: [hiddenTaskMiddleware],
                    validate: [],
                  },
                },
              },
            },
          ],
        ]),
      });

      expect(() => tracker.validateVisibility(registry as any)).toThrow(
        /internal to resource/,
      );
    });

    it("throws when subtree resource middleware is not visible to the policy owner", () => {
      const hiddenOwner = defineResource({
        id: "tracker-subtree-hidden-owner-resource",
      });
      const policyOwner = defineResource({
        id: "tracker-subtree-policy-owner-resource",
      });
      const hiddenResourceMiddleware = defineResourceMiddleware({
        id: "tracker-subtree-hidden-resource-middleware",
        run: async ({ next }) => next(),
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", hiddenOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(hiddenOwner.id, hiddenResourceMiddleware);
      tracker.recordExports(hiddenOwner.id, []);

      const registry = createVisibilityRegistry({
        resourceMiddlewares: new Map([
          [
            hiddenResourceMiddleware.id,
            { middleware: hiddenResourceMiddleware },
          ],
        ]),
        resources: new Map([
          [hiddenOwner.id, { resource: hiddenOwner }],
          [
            policyOwner.id,
            {
              resource: {
                ...policyOwner,
                subtree: {
                  resources: {
                    middleware: [hiddenResourceMiddleware],
                    validate: [],
                  },
                },
              },
            },
          ],
        ]),
      });

      expect(() => tracker.validateVisibility(registry as any)).toThrow(
        /internal to resource/,
      );
    });
  });

  describe("tagging visibility checks", () => {
    it("throws when a tag attachment is not visible to the attaching definition", () => {
      const hiddenOwner = defineResource({
        id: "tracker-tagging-hidden-owner",
      });
      const policyOwner = defineResource({
        id: "tracker-tagging-policy-owner",
      });
      const hiddenTag = defineTag({
        id: "tracker-tagging-hidden-tag",
      });
      const taggedTask = defineTask({
        id: "tracker-tagging-consumer-task",
        tags: [hiddenTag],
        run: async () => "ok",
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", hiddenOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(hiddenOwner.id, hiddenTag);
      tracker.recordOwnership(policyOwner.id, taggedTask);
      tracker.recordExports(hiddenOwner.id, []);

      const registry = createVisibilityRegistry({
        tasks: new Map([[taggedTask.id, { task: taggedTask }]]),
        resources: new Map([
          [hiddenOwner.id, { resource: hiddenOwner }],
          [policyOwner.id, { resource: policyOwner }],
        ]),
      });

      expect(() => tracker.validateVisibility(registry as any)).toThrow(
        /internal to resource/,
      );
    });

    it("throws an isolation error when tagging is visible but denied by policy", () => {
      const tagOwner = defineResource({
        id: "tracker-tagging-denied-tag-owner",
      });
      const policyOwner = defineResource({
        id: "tracker-tagging-denied-policy-owner",
      });
      const sharedTag = defineTag({
        id: "tracker-tagging-denied-shared-tag",
      });
      const taggedTask = defineTask({
        id: "tracker-tagging-denied-task",
        tags: [sharedTag],
        run: async () => "ok",
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", tagOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(tagOwner.id, sharedTag);
      tracker.recordOwnership(policyOwner.id, taggedTask);
      tracker.recordExports(tagOwner.id, [sharedTag]);
      tracker.recordIsolation(policyOwner.id, {
        deny: [sharedTag],
      });

      const registry = createVisibilityRegistry({
        tasks: new Map([[taggedTask.id, { task: taggedTask }]]),
        resources: new Map([
          [tagOwner.id, { resource: tagOwner }],
          [policyOwner.id, { resource: policyOwner }],
        ]),
      });

      expect(() => tracker.validateVisibility(registry as any)).toThrow(
        expect.objectContaining({ id: "isolationViolation" }),
      );
    });

    it("allows a denied tag target when the tagging channel is disabled", () => {
      const tagOwner = defineResource({
        id: "tracker-tagging-allow-tag-owner",
      });
      const policyOwner = defineResource({
        id: "tracker-tagging-allow-policy-owner",
      });
      const sharedTag = defineTag({
        id: "tracker-tagging-allow-shared-tag",
      });
      const taggedTask = defineTask({
        id: "tracker-tagging-allow-task",
        tags: [sharedTag],
        run: async () => "ok",
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", tagOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(tagOwner.id, sharedTag);
      tracker.recordOwnership(policyOwner.id, taggedTask);
      tracker.recordIsolation(policyOwner.id, {
        deny: [scope(sharedTag, { tagging: false })],
      });

      const registry = createVisibilityRegistry({
        tasks: new Map([[taggedTask.id, { task: taggedTask }]]),
        resources: new Map([
          [tagOwner.id, { resource: tagOwner }],
          [policyOwner.id, { resource: policyOwner }],
        ]),
      });

      expect(() => tracker.validateVisibility(registry as any)).not.toThrow();
    });

    it("skips unresolved tag references during tagging validation", () => {
      const policyOwner = defineResource({
        id: "tracker-tagging-unresolved-policy-owner",
      });
      const taggedTask = defineTask({
        id: "tracker-tagging-unresolved-task",
        tags: [{ unresolved: true } as any],
        run: async () => "ok",
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(policyOwner.id, taggedTask);

      const registry = createVisibilityRegistry({
        tasks: new Map([[taggedTask.id, { task: taggedTask }]]),
        resources: new Map([[policyOwner.id, { resource: policyOwner }]]),
      });

      expect(() => tracker.validateVisibility(registry as any)).not.toThrow();
    });
  });

  it("skips hooks without an on target during visibility validation", () => {
    const registry = createVisibilityRegistry({
      hooks: new Map([
        [
          "tracker-hook-no-on",
          {
            hook: {
              id: "tracker-hook-no-on",
              on: undefined,
            },
          },
        ],
      ]),
    });

    expect(() => tracker.validateVisibility(registry as any)).not.toThrow();
  });

  it("fails fast when a resolved target id is missing from all registry buckets", () => {
    const policyOwner = defineResource({
      id: "tracker-missing-type-policy-owner",
      dependencies: {
        phantom: { id: "tracker-missing-type-target" } as any,
      },
    });

    tracker.recordResource(policyOwner.id);
    tracker.recordIsolation(policyOwner.id, { only: [] });

    const registry = createVisibilityRegistry({
      resources: new Map([[policyOwner.id, { resource: policyOwner }]]),
    });

    expect(() => tracker.validateVisibility(registry as any)).toThrow(
      expect.objectContaining({ id: "validation" }),
    );
  });
});
