import { defineResource, defineTask } from "../../define";
import { VisibilityTracker } from "../../models/VisibilityTracker";

describe("VisibilityTracker state", () => {
  let tracker: VisibilityTracker;

  beforeEach(() => {
    tracker = new VisibilityTracker();
  });

  describe("recordOwnership", () => {
    it("tracks item ownership", () => {
      const task = defineTask({
        id: "tracker-task",
        run: async () => "done",
      });

      tracker.recordOwnership("resource-owner", task);

      expect(tracker.getOwnerResourceId("tracker-task")).toBe("resource-owner");
    });

    it("ignores items without id", () => {
      tracker.recordOwnership("resource-owner", null as any);

      expect(tracker.getOwnerResourceId("resource-owner")).toBeUndefined();
    });

    it("builds subtree chains up to ancestors", () => {
      const parentResource = defineResource({
        id: "tracker-parent",
        register: [],
      });
      const childTask = defineTask({
        id: "tracker-child-task",
        run: async () => "done",
      });

      tracker.recordOwnership("root", parentResource);
      tracker.recordOwnership("tracker-parent", childTask);

      expect(tracker.getOwnerResourceId("tracker-child-task")).toBe(
        "tracker-parent",
      );
      expect(tracker.getOwnerResourceId("tracker-parent")).toBe("root");
      expect(
        tracker.isWithinResourceSubtree("tracker-parent", "tracker-child-task"),
      ).toBe(true);
      expect(
        tracker.isWithinResourceSubtree("root", "tracker-child-task"),
      ).toBe(true);
    });

    it("ignores duplicate ownership attempts to avoid cycles", () => {
      const resourceA = defineResource({
        id: "tracker-cycle-a",
        register: [],
      });
      const resourceB = defineResource({
        id: "tracker-cycle-b",
        register: [],
      });

      tracker.recordOwnership("root", resourceA);
      tracker.recordOwnership("tracker-cycle-a", resourceB);
      tracker.recordOwnership("tracker-cycle-b", resourceA);

      expect(tracker.getOwnerResourceId("tracker-cycle-a")).toBe("root");
      expect(tracker.getOwnerResourceId("tracker-cycle-b")).toBe(
        "tracker-cycle-a",
      );
    });
  });

  describe("recordExports", () => {
    it("stores export ids", () => {
      const task1 = defineTask({
        id: "tracker-export-t1",
        run: async () => "one",
      });
      const task2 = defineTask({
        id: "tracker-export-t2",
        run: async () => "two",
      });

      tracker.recordExports("resource-id", [task1, task2]);

      const firstAccess = tracker.getRootAccessInfo(
        "tracker-export-t1",
        "resource-id",
      );
      const secondAccess = tracker.getRootAccessInfo(
        "tracker-export-t2",
        "resource-id",
      );

      expect(firstAccess.accessible).toBe(true);
      expect(secondAccess.accessible).toBe(true);
      expect(firstAccess.exportedIds).toHaveLength(2);
      expect(firstAccess.exportedIds).toEqual(
        expect.arrayContaining(["tracker-export-t1", "tracker-export-t2"]),
      );
    });

    it("handles empty exports array", () => {
      tracker.recordExports("resource-id", []);

      expect(
        tracker.getRootAccessInfo("tracker-export-missing", "resource-id"),
      ).toEqual({
        accessible: false,
        exportedIds: [],
      });
    });

    it("skips items without extractable id", () => {
      const task = defineTask({
        id: "tracker-export-valid",
        run: async () => "ok",
      });

      tracker.recordExports("resource-id", [task, (() => {}) as any]);

      expect(
        tracker.getRootAccessInfo("tracker-export-valid", "resource-id"),
      ).toEqual({
        accessible: true,
        exportedIds: ["tracker-export-valid"],
      });
      expect(
        tracker.getRootAccessInfo("tracker-export-missing", "resource-id"),
      ).toEqual({
        accessible: false,
        exportedIds: ["tracker-export-valid"],
      });
    });

    it("stores string export ids directly", () => {
      tracker.recordExports("resource-id", ["tracker-export-direct"]);

      expect(
        tracker.getRootAccessInfo("tracker-export-direct", "resource-id"),
      ).toEqual({
        accessible: true,
        exportedIds: ["tracker-export-direct"],
      });
    });

    it("resolves ids from resource-with-config", () => {
      const resource = defineResource<{ port: number }>({
        id: "tracker-rwc-res",
        async init() {
          return "value" as any;
        },
      });

      tracker.recordExports("owner", [resource.with({ port: 3000 })]);

      expect(tracker.getRootAccessInfo("tracker-rwc-res", "owner")).toEqual({
        accessible: true,
        exportedIds: ["tracker-rwc-res"],
      });
    });
  });

  describe("rollbackOwnershipTree", () => {
    it("rolls back ownership transitively for descendants of a failed registration", () => {
      const childResource = defineResource({
        id: "tracker-rollback-child",
      });
      const nestedTask = defineTask({
        id: "tracker-rollback-nested-task",
        run: async () => "ok",
      });

      tracker.recordOwnership("tracker-rollback-root", childResource);
      tracker.recordOwnership(childResource.id, nestedTask);

      expect(tracker.getOwnerResourceId(childResource.id)).toBe(
        "tracker-rollback-root",
      );
      expect(tracker.getOwnerResourceId(nestedTask.id)).toBe(childResource.id);

      tracker.rollbackOwnershipTree(childResource.id);

      expect(tracker.getOwnerResourceId(childResource.id)).toBeUndefined();
      expect(tracker.getOwnerResourceId(nestedTask.id)).toBeUndefined();
    });

    it("returns early when rollback is requested for an unknown id", () => {
      const task = defineTask({
        id: "tracker-rollback-safe-task",
        run: async () => "ok",
      });

      tracker.recordOwnership("tracker-rollback-owner", task);
      tracker.rollbackOwnershipTree("tracker-rollback-missing");

      expect(tracker.getOwnerResourceId(task.id)).toBe(
        "tracker-rollback-owner",
      );
    });
  });

  it("treats a resource as inside its own subtree", () => {
    expect(
      tracker.isWithinResourceSubtree(
        "tracker-subtree-self",
        "tracker-subtree-self",
      ),
    ).toBe(true);
  });
});
