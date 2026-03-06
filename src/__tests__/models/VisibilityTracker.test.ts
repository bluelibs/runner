import {
  defineTag,
  defineTask,
  defineResource,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../define";
import { scope, subtreeOf } from "../../public";
import { VisibilityTracker } from "../../models/VisibilityTracker";

const resolveDefinitionId = (reference: unknown): string | undefined => {
  if (typeof reference === "string") {
    return reference;
  }
  if (reference && typeof reference === "object" && "id" in reference) {
    const id = (reference as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  return undefined;
};

const getDisplayId = (id: string): string => id;

describe("VisibilityTracker", () => {
  let tracker: VisibilityTracker;

  beforeEach(() => {
    tracker = new VisibilityTracker();
  });

  describe("recordOwnership", () => {
    it("should track item ownership", () => {
      const task = defineTask({
        id: "tracker.task",
        run: async () => "done",
      });

      tracker.recordOwnership("resource.owner", task);
      expect(tracker.getOwnership().get("tracker.task")).toBe("resource.owner");
    });

    it("should ignore items without id", () => {
      // passing something that has no id — should be no-op
      tracker.recordOwnership("resource.owner", null as any);
      expect(tracker.getOwnership().size).toBe(0);
    });

    it("should build subtree chains up to ancestors", () => {
      const parentResource = defineResource({
        id: "tracker.parent",
        register: [],
      });

      const childTask = defineTask({
        id: "tracker.child-task",
        run: async () => "done",
      });

      // Parent resource is owned by root
      tracker.recordOwnership("root", parentResource);
      // Child task is owned by parent resource
      tracker.recordOwnership("tracker.parent", childTask);

      // Child task should be in both parent subtree and root subtree
      const ownership = tracker.getOwnership();
      expect(ownership.get("tracker.child-task")).toBe("tracker.parent");
      expect(ownership.get("tracker.parent")).toBe("root");
    });

    it("should ignore duplicate ownership attempts to avoid cycles", () => {
      const resourceA = defineResource({
        id: "tracker.cycle.a",
        register: [],
      });
      const resourceB = defineResource({
        id: "tracker.cycle.b",
        register: [],
      });

      tracker.recordOwnership("root", resourceA);
      tracker.recordOwnership("tracker.cycle.a", resourceB);
      tracker.recordOwnership("tracker.cycle.b", resourceA);

      const ownership = tracker.getOwnership();
      expect(ownership.get("tracker.cycle.a")).toBe("root");
      expect(ownership.get("tracker.cycle.b")).toBe("tracker.cycle.a");
    });
  });

  describe("recordExports", () => {
    it("should store export ids", () => {
      const task1 = defineTask({
        id: "tracker.export.t1",
        run: async () => "one",
      });

      const task2 = defineTask({
        id: "tracker.export.t2",
        run: async () => "two",
      });

      tracker.recordExports("resource.id", [task1, task2]);

      const exportSets = tracker.getExportSets();
      const exportSet = exportSets.get("resource.id");
      expect(exportSet).toBeDefined();
      expect(exportSet!.has("tracker.export.t1")).toBe(true);
      expect(exportSet!.has("tracker.export.t2")).toBe(true);
    });

    it("should handle empty exports array", () => {
      tracker.recordExports("resource.id", []);
      const exportSets = tracker.getExportSets();
      const exportSet = exportSets.get("resource.id");
      expect(exportSet).toBeDefined();
      expect(exportSet!.size).toBe(0);
    });

    it("should skip items without extractable id", () => {
      const task = defineTask({
        id: "tracker.export.valid",
        run: async () => "ok",
      });

      // A bare function has no id — getItemId returns undefined
      tracker.recordExports("resource.id", [task, (() => {}) as any]);
      const exportSet = tracker.getExportSets().get("resource.id");
      expect(exportSet).toBeDefined();
      expect(exportSet!.size).toBe(1);
      expect(exportSet!.has("tracker.export.valid")).toBe(true);
    });

    it("stores string export ids directly", () => {
      tracker.recordExports("resource.id", ["tracker.export.direct"]);
      const exportSet = tracker.getExportSets().get("resource.id");
      expect(exportSet).toBeDefined();
      expect(exportSet!.has("tracker.export.direct")).toBe(true);
    });
  });

  describe("isAccessible", () => {
    it("should return true for untracked items", () => {
      expect(tracker.isAccessible("unknown.item", "consumer")).toBe(true);
    });

    it("should allow access when no exports declared", () => {
      const task = defineTask({
        id: "tracker.access.task",
        run: async () => "done",
      });

      tracker.recordOwnership("owner", task);
      expect(tracker.isAccessible("tracker.access.task", "external")).toBe(
        true,
      );
    });

    it("should allow access for items in same subtree", () => {
      const task1 = defineTask({
        id: "tracker.same-sub.t1",
        run: async () => "one",
      });
      const task2 = defineTask({
        id: "tracker.same-sub.t2",
        run: async () => "two",
      });

      tracker.recordOwnership("owner", task1);
      tracker.recordOwnership("owner", task2);
      tracker.recordExports("owner", [task1]);

      // task2 is in the same subtree as task1
      expect(
        tracker.isAccessible("tracker.same-sub.t1", "tracker.same-sub.t2"),
      ).toBe(true);
    });

    it("should allow owner resource access to its own non-exported items", () => {
      const task = defineTask({
        id: "tracker.owner-scope.task",
        run: async () => "value",
      });

      tracker.recordOwnership("tracker.owner-scope.resource", task);
      tracker.recordExports("tracker.owner-scope.resource", []);

      expect(
        tracker.isAccessible(
          "tracker.owner-scope.task",
          "tracker.owner-scope.resource",
        ),
      ).toBe(true);
    });

    it("should deny access for non-exported items from outside", () => {
      const exported = defineTask({
        id: "tracker.deny.exported",
        run: async () => "e",
      });
      const internal = defineTask({
        id: "tracker.deny.internal",
        run: async () => "i",
      });

      tracker.recordOwnership("owner", exported);
      tracker.recordOwnership("owner", internal);
      tracker.recordExports("owner", [exported]);

      // External consumer should see exported
      expect(tracker.isAccessible("tracker.deny.exported", "external")).toBe(
        true,
      );
      // External consumer should NOT see internal
      expect(tracker.isAccessible("tracker.deny.internal", "external")).toBe(
        false,
      );
    });

    it("should allow transitive visibility via exported resources", () => {
      const deepTask = defineTask({
        id: "tracker.nested.deep",
        run: async () => "deep",
      });

      const middleResource = defineResource({
        id: "tracker.nested.middle",
        register: [],
      });

      // Root owns middle, middle owns deep
      tracker.recordOwnership("root", middleResource);
      tracker.recordOwnership("tracker.nested.middle", deepTask);

      // Middle exports deep
      tracker.recordExports("tracker.nested.middle", [deepTask]);

      // Root has no exports, so deep stays publicly visible.
      expect(tracker.isAccessible("tracker.nested.deep", "external")).toBe(
        true,
      );

      // Root exports the child resource; this should surface the child's exports.
      tracker.recordExports("root", [middleResource]);
      expect(tracker.isAccessible("tracker.nested.deep", "external")).toBe(
        true,
      );
    });

    it("should block transitive visibility when child resource does not export target", () => {
      const deepTask = defineTask({
        id: "tracker.nested.blocked.deep",
        run: async () => "deep",
      });
      const middleResource = defineResource({
        id: "tracker.nested.blocked.middle",
        register: [],
      });

      tracker.recordOwnership("root", middleResource);
      tracker.recordOwnership("tracker.nested.blocked.middle", deepTask);

      tracker.recordExports("tracker.nested.blocked.middle", []);
      tracker.recordExports("root", [middleResource]);

      expect(
        tracker.isAccessible("tracker.nested.blocked.deep", "external"),
      ).toBe(false);
    });
  });

  describe("resource with config in exports", () => {
    it("should resolve id from resource-with-config", () => {
      const res = defineResource<{ port: number }>({
        id: "tracker.rwc.res",
        async init() {
          return "val" as any;
        },
      });

      const configured = res.with({ port: 3000 });
      tracker.recordExports("owner", [configured]);

      const exportSets = tracker.getExportSets();
      expect(exportSets.get("owner")!.has("tracker.rwc.res")).toBe(true);
    });
  });

  describe("internal guards", () => {
    it("should skip already-seen traversal keys", () => {
      const deepTask = defineTask({
        id: "tracker.guard.deep",
        run: async () => "deep",
      });
      const middleResource = defineResource({
        id: "tracker.guard.middle",
        register: [],
      });

      tracker.recordOwnership("root", middleResource);
      tracker.recordOwnership("tracker.guard.middle", deepTask);
      tracker.recordExports("tracker.guard.middle", [deepTask]);
      tracker.recordExports("root", [middleResource]);

      const seenPaths = new Set([
        "root::tracker.guard.middle::tracker.guard.deep",
      ]);

      const isAllowed = (tracker as any).isTargetAllowedByExports(
        "tracker.guard.deep",
        "root",
        seenPaths,
      );
      expect(isAllowed).toBe(false);
    });

    it("should return an empty export set when no gating set exists in chain", () => {
      const gatingSet = (tracker as any).findGatingExportSet(
        "tracker.guard.none",
        "tracker.guard.owner.none",
      ) as Set<string>;
      expect(gatingSet.size).toBe(0);
    });
  });

  describe("isolate", () => {
    it("denies by id for resources in policy scope", () => {
      const owner = defineResource({
        id: "tracker.policy.owner",
      });
      const blockedTask = defineTask({
        id: "tracker.policy.task.blocked",
        run: async () => "blocked",
      });
      const consumerTask = defineTask({
        id: "tracker.policy.task.consumer",
        run: async () => "consumer",
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, blockedTask);
      tracker.recordOwnership(owner.id, consumerTask);
      tracker.recordIsolation(owner.id, {
        deny: [blockedTask],
      });

      expect(tracker.isAccessible(blockedTask.id, consumerTask.id)).toBeFalsy();
    });

    it("denies by tag for tagged targets and tag dependencies", () => {
      const owner = defineResource({
        id: "tracker.policy.tag.owner",
      });
      const denyTag = defineTag({
        id: "tracker.policy.tag.deny",
      });
      const blockedTask = defineTask({
        id: "tracker.policy.tag.task",
        run: async () => "blocked",
      });
      const consumerTask = defineTask({
        id: "tracker.policy.tag.consumer",
        run: async () => "consumer",
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, blockedTask);
      tracker.recordOwnership(owner.id, consumerTask);
      tracker.recordDefinitionTags(blockedTask.id, [denyTag]);
      tracker.recordIsolation(owner.id, {
        deny: [denyTag],
      });

      expect(tracker.isAccessible(blockedTask.id, consumerTask.id)).toBeFalsy();
      expect(tracker.isAccessible(denyTag.id, consumerTask.id)).toBeFalsy();
    });

    it("removes policy when deny list is empty", () => {
      const owner = defineResource({
        id: "tracker.policy.clear.owner",
      });
      const task = defineTask({
        id: "tracker.policy.clear.task",
        run: async () => "ok",
      });
      const consumer = defineTask({
        id: "tracker.policy.clear.consumer",
        run: async () => "ok",
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, task);
      tracker.recordOwnership(owner.id, consumer);
      tracker.recordIsolation(owner.id, { deny: [task] });
      tracker.recordIsolation(owner.id, { deny: [] });

      expect(tracker.isAccessible(task.id, consumer.id)).toBe(true);
    });

    it("ignores scope targets without resolvable ids", () => {
      const owner = defineResource({
        id: "tracker.policy.scope.invalid.owner",
      });
      const task = defineTask({
        id: "tracker.policy.scope.invalid.task",
        run: async () => "ok",
      });
      const consumer = defineTask({
        id: "tracker.policy.scope.invalid.consumer",
        run: async () => "ok",
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, task);
      tracker.recordOwnership(owner.id, consumer);
      tracker.recordIsolation(owner.id, {
        deny: [scope({ nonResolvable: true } as never)],
      });

      expect(tracker.isAccessible(task.id, consumer.id)).toBe(true);
    });

    it("supports per-channel scope toggles for subtree, string, tag, and id targets", () => {
      const owner = defineResource({
        id: "tracker.policy.channel.owner",
      });
      const child = defineResource({
        id: "tracker.policy.channel.child",
      });
      const directTask = defineTask({
        id: "tracker.policy.channel.direct-task",
        run: async () => "ok",
      });
      const directIdTask = defineTask({
        id: "tracker.policy.channel.direct-id-task",
        run: async () => "ok",
      });
      const childTask = defineTask({
        id: "tracker.policy.channel.child-task",
        run: async () => "ok",
      });
      const taggedTask = defineTask({
        id: "tracker.policy.channel.tagged-task",
        run: async () => "ok",
      });
      const denyTag = defineTag({
        id: "tracker.policy.channel.tag",
      });
      const consumer = defineTask({
        id: "tracker.policy.channel.consumer",
        run: async () => "ok",
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, child);
      tracker.recordOwnership(owner.id, directTask);
      tracker.recordOwnership(owner.id, directIdTask);
      tracker.recordOwnership(child.id, childTask);
      tracker.recordOwnership(owner.id, taggedTask);
      tracker.recordOwnership(owner.id, consumer);
      tracker.recordDefinitionTags(taggedTask.id, [denyTag]);

      tracker.recordIsolation(owner.id, {
        deny: [
          scope(subtreeOf(child), { dependencies: false }),
          scope(directIdTask, { listening: false }),
          scope(denyTag, { middleware: false }),
          scope(directTask, { tagging: false }),
        ],
      });

      expect(
        tracker.isAccessible(childTask.id, consumer.id, "dependencies"),
      ).toBe(true);
      expect(tracker.isAccessible(childTask.id, consumer.id, "listening")).toBe(
        false,
      );
      expect(
        tracker.isAccessible(directIdTask.id, consumer.id, "dependencies"),
      ).toBe(false);
      expect(
        tracker.isAccessible(directIdTask.id, consumer.id, "listening"),
      ).toBe(true);
      expect(tracker.isAccessible(directTask.id, consumer.id, "tagging")).toBe(
        true,
      );
      expect(
        tracker.isAccessible(directTask.id, consumer.id, "dependencies"),
      ).toBe(false);
      expect(
        tracker.isAccessible(taggedTask.id, consumer.id, "middleware"),
      ).toBe(true);
      expect(
        tracker.isAccessible(taggedTask.id, consumer.id, "dependencies"),
      ).toBe(false);
    });
  });

  describe("isolate (only mode)", () => {
    it("allows a target that is in the only list", () => {
      const owner = defineResource({ id: "tracker.only.allow.owner" });
      const allowed = defineTask({
        id: "tracker.only.allow.task",
        run: async () => {},
      });
      const consumer = defineTask({
        id: "tracker.only.allow.consumer",
        run: async () => {},
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, consumer);
      tracker.recordIsolation(owner.id, { only: [allowed] });

      expect(tracker.isAccessible(allowed.id, consumer.id)).toBe(true);
    });

    it("blocks a target that is not in the only list", () => {
      const owner = defineResource({ id: "tracker.only.block.owner" });
      const forbidden = defineTask({
        id: "tracker.only.block.task",
        run: async () => {},
      });
      const consumer = defineTask({
        id: "tracker.only.block.consumer",
        run: async () => {},
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, consumer);
      // Empty only list means no external deps allowed.
      tracker.recordIsolation(owner.id, { only: [] });

      expect(tracker.isAccessible(forbidden.id, consumer.id)).toBe(false);
    });

    it("allows internal items even when they are not in the only list", () => {
      const owner = defineResource({ id: "tracker.only.internal.owner" });
      const internal = defineTask({
        id: "tracker.only.internal.task",
        run: async () => {},
      });
      const consumer = defineTask({
        id: "tracker.only.internal.consumer",
        run: async () => {},
      });

      tracker.recordResource(owner.id);
      // Both registered under owner — they are internal.
      tracker.recordOwnership(owner.id, internal);
      tracker.recordOwnership(owner.id, consumer);
      // Only list is empty, but internal items still pass.
      tracker.recordIsolation(owner.id, { only: [] });

      expect(tracker.isAccessible(internal.id, consumer.id)).toBe(true);
    });

    it("allows an only-listed tag and targets carrying that tag", () => {
      const owner = defineResource({ id: "tracker.only.tag.owner" });
      const allowedTag = defineTag({ id: "tracker.only.tag.allowed" });
      const taggedTask = defineTask({
        id: "tracker.only.tag.task",
        run: async () => {},
      });
      const consumer = defineTask({
        id: "tracker.only.tag.consumer",
        run: async () => {},
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, consumer);
      tracker.recordDefinitionTags(taggedTask.id, [allowedTag]);
      tracker.recordIsolation(owner.id, { only: [allowedTag] });

      // The tag itself is allowed.
      expect(tracker.isAccessible(allowedTag.id, consumer.id)).toBe(true);
      // A task tagged with the allowed tag is also allowed.
      expect(tracker.isAccessible(taggedTask.id, consumer.id)).toBe(true);
    });

    it("blocks a task whose tag is not in the only list", () => {
      const owner = defineResource({ id: "tracker.only.tag.block.owner" });
      const allowedTag = defineTag({ id: "tracker.only.tag.block.allowed" });
      const notAllowedTag = defineTag({ id: "tracker.only.tag.block.denied" });
      const blockedTask = defineTask({
        id: "tracker.only.tag.block.task",
        run: async () => {},
      });
      const consumer = defineTask({
        id: "tracker.only.tag.block.consumer",
        run: async () => {},
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, consumer);
      tracker.recordDefinitionTags(blockedTask.id, [notAllowedTag]);
      tracker.recordIsolation(owner.id, { only: [allowedTag] });

      expect(tracker.isAccessible(blockedTask.id, consumer.id)).toBe(false);
    });
  });

  describe("subtree middleware visibility checks", () => {
    it("throws when subtree task middleware is not visible to the policy owner", () => {
      const hiddenOwner = defineResource({
        id: "tracker.subtree.hidden.owner.task",
      });
      const policyOwner = defineResource({
        id: "tracker.subtree.policy.owner.task",
      });
      const hiddenTaskMiddleware = defineTaskMiddleware({
        id: "tracker.subtree.hidden.task.middleware",
        run: async ({ next, task }) => next(task.input),
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", hiddenOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(hiddenOwner.id, hiddenTaskMiddleware);
      tracker.recordExports(hiddenOwner.id, []);

      const registry = {
        tasks: new Map(),
        events: new Map(),
        hooks: new Map(),
        taskMiddlewares: new Map([
          [hiddenTaskMiddleware.id, { middleware: hiddenTaskMiddleware }],
        ]),
        resourceMiddlewares: new Map(),
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
        resolveDefinitionId,
        getDisplayId,
      };

      expect(() => tracker.validateVisibility(registry as any)).toThrow(
        /internal to resource/,
      );
    });

    it("throws when subtree resource middleware is not visible to the policy owner", () => {
      const hiddenOwner = defineResource({
        id: "tracker.subtree.hidden.owner.resource",
      });
      const policyOwner = defineResource({
        id: "tracker.subtree.policy.owner.resource",
      });
      const hiddenResourceMiddleware = defineResourceMiddleware({
        id: "tracker.subtree.hidden.resource.middleware",
        run: async ({ next }) => next(),
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", hiddenOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(hiddenOwner.id, hiddenResourceMiddleware);
      tracker.recordExports(hiddenOwner.id, []);

      const registry = {
        tasks: new Map(),
        events: new Map(),
        hooks: new Map(),
        taskMiddlewares: new Map(),
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
        resolveDefinitionId,
        getDisplayId,
      };

      expect(() => tracker.validateVisibility(registry as any)).toThrow(
        /internal to resource/,
      );
    });
  });

  describe("tagging visibility checks", () => {
    it("throws when a tag attachment is not visible to the attaching definition", () => {
      const hiddenOwner = defineResource({
        id: "tracker.tagging.hidden-owner",
      });
      const policyOwner = defineResource({
        id: "tracker.tagging.policy-owner",
      });
      const hiddenTag = defineTag({
        id: "tracker.tagging.hidden-tag",
      });
      const taggedTask = defineTask({
        id: "tracker.tagging.consumer-task",
        tags: [hiddenTag],
        run: async () => "ok",
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", hiddenOwner);
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(hiddenOwner.id, hiddenTag);
      tracker.recordOwnership(policyOwner.id, taggedTask);
      tracker.recordExports(hiddenOwner.id, []);

      const registry = {
        tasks: new Map([[taggedTask.id, { task: taggedTask }]]),
        events: new Map(),
        hooks: new Map(),
        taskMiddlewares: new Map(),
        resourceMiddlewares: new Map(),
        resources: new Map([
          [hiddenOwner.id, { resource: hiddenOwner }],
          [policyOwner.id, { resource: policyOwner }],
        ]),
        resolveDefinitionId,
        getDisplayId,
      };

      expect(() => tracker.validateVisibility(registry as any)).toThrow(
        /internal to resource/,
      );
    });

    it("allows a denied tag target when the tagging channel is disabled", () => {
      const tagOwner = defineResource({
        id: "tracker.tagging.allow.tag-owner",
      });
      const policyOwner = defineResource({
        id: "tracker.tagging.allow.policy-owner",
      });
      const sharedTag = defineTag({
        id: "tracker.tagging.allow.shared-tag",
      });
      const taggedTask = defineTask({
        id: "tracker.tagging.allow.task",
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

      const registry = {
        tasks: new Map([[taggedTask.id, { task: taggedTask }]]),
        events: new Map(),
        hooks: new Map(),
        taskMiddlewares: new Map(),
        resourceMiddlewares: new Map(),
        resources: new Map([
          [tagOwner.id, { resource: tagOwner }],
          [policyOwner.id, { resource: policyOwner }],
        ]),
        resolveDefinitionId,
        getDisplayId,
      };

      expect(() => tracker.validateVisibility(registry as any)).not.toThrow();
    });

    it("skips unresolved tag references during tagging validation", () => {
      const policyOwner = defineResource({
        id: "tracker.tagging.unresolved.policy-owner",
      });

      const taggedTask = defineTask({
        id: "tracker.tagging.unresolved.task",
        tags: [{ unresolved: true } as any],
        run: async () => "ok",
      });

      tracker.recordResource("root");
      tracker.recordOwnership("root", policyOwner);
      tracker.recordOwnership(policyOwner.id, taggedTask);

      const registry = {
        tasks: new Map([[taggedTask.id, { task: taggedTask }]]),
        events: new Map(),
        hooks: new Map(),
        taskMiddlewares: new Map(),
        resourceMiddlewares: new Map(),
        resources: new Map([[policyOwner.id, { resource: policyOwner }]]),
        resolveDefinitionId,
        getDisplayId,
      };

      expect(() => tracker.validateVisibility(registry as any)).not.toThrow();
    });
  });

  describe("regression branches", () => {
    it("uses dependencies channel by default in getAccessViolation()", () => {
      const owner = defineResource({ id: "tracker.default-channel.owner" });
      const blocked = defineTask({
        id: "tracker.default-channel.blocked",
        run: async () => "blocked",
      });
      const consumer = defineTask({
        id: "tracker.default-channel.consumer",
        run: async () => "consumer",
      });

      tracker.recordResource(owner.id);
      tracker.recordOwnership(owner.id, blocked);
      tracker.recordOwnership(owner.id, consumer);
      tracker.recordIsolation(owner.id, { deny: [blocked] });

      const violation = tracker.getAccessViolation(blocked.id, consumer.id);
      expect(violation).toMatchObject({
        kind: "isolate",
        channel: "dependencies",
      });
    });

    it("skips hooks without an `on` target during visibility validation", () => {
      const registry = {
        tasks: new Map(),
        events: new Map(),
        hooks: new Map([
          [
            "tracker.hook.no-on",
            {
              hook: {
                id: "tracker.hook.no-on",
                on: undefined,
              },
            },
          ],
        ]),
        taskMiddlewares: new Map(),
        resourceMiddlewares: new Map(),
        resources: new Map(),
        resolveDefinitionId,
        getDisplayId,
      };

      expect(() => tracker.validateVisibility(registry as any)).not.toThrow();
    });

    it("rolls back ownership transitively for descendants of a failed registration", () => {
      const childResource = defineResource({
        id: "tracker.rollback.child",
      });
      const nestedTask = defineTask({
        id: "tracker.rollback.nested-task",
        run: async () => "ok",
      });

      tracker.recordOwnership("tracker.rollback.root", childResource);
      tracker.recordOwnership(childResource.id, nestedTask);

      expect(tracker.getOwnership().has(childResource.id)).toBe(true);
      expect(tracker.getOwnership().has(nestedTask.id)).toBe(true);

      tracker.rollbackOwnershipTree(childResource.id);

      expect(tracker.getOwnership().has(childResource.id)).toBe(false);
      expect(tracker.getOwnership().has(nestedTask.id)).toBe(false);
    });

    it("returns early when rollback is requested for an unknown id", () => {
      const task = defineTask({
        id: "tracker.rollback.safe-task",
        run: async () => "ok",
      });
      tracker.recordOwnership("tracker.rollback.owner", task);

      tracker.rollbackOwnershipTree("tracker.rollback.missing");

      expect(tracker.getOwnership().get(task.id)).toBe(
        "tracker.rollback.owner",
      );
    });
  });

  it("treats a resource as inside its own subtree", () => {
    expect(
      tracker.isWithinResourceSubtree(
        "tracker.subtree.self",
        "tracker.subtree.self",
      ),
    ).toBe(true);
  });
});
