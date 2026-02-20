import { defineTask, defineResource } from "../../define";
import { VisibilityTracker } from "../../models/VisibilityTracker";

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
});
