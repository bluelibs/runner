import { defineResource, defineTask } from "../../define";
import { VisibilityTracker } from "../../models/VisibilityTracker";

describe("VisibilityTracker visibility", () => {
  let tracker: VisibilityTracker;

  beforeEach(() => {
    tracker = new VisibilityTracker();
  });

  describe("isAccessible", () => {
    it("returns true for untracked items", () => {
      expect(tracker.isAccessible("unknown-item", "consumer")).toBe(true);
    });

    it("allows access when no exports are declared", () => {
      const task = defineTask({
        id: "tracker-access-task",
        run: async () => "done",
      });

      tracker.recordOwnership("owner", task);

      expect(tracker.isAccessible("tracker-access-task", "external")).toBe(
        true,
      );
    });

    it("allows access for items in the same subtree", () => {
      const task1 = defineTask({
        id: "tracker-same-sub-t1",
        run: async () => "one",
      });
      const task2 = defineTask({
        id: "tracker-same-sub-t2",
        run: async () => "two",
      });

      tracker.recordOwnership("owner", task1);
      tracker.recordOwnership("owner", task2);
      tracker.recordExports("owner", [task1]);

      expect(
        tracker.isAccessible("tracker-same-sub-t1", "tracker-same-sub-t2"),
      ).toBe(true);
    });

    it("allows the owner resource to access its own non-exported items", () => {
      const task = defineTask({
        id: "tracker-owner-scope-task",
        run: async () => "value",
      });

      tracker.recordOwnership("tracker-owner-scope-resource", task);
      tracker.recordExports("tracker-owner-scope-resource", []);

      expect(
        tracker.isAccessible(
          "tracker-owner-scope-task",
          "tracker-owner-scope-resource",
        ),
      ).toBe(true);
    });

    it("denies access for non-exported items from outside", () => {
      const exported = defineTask({
        id: "tracker-deny-exported",
        run: async () => "e",
      });
      const internal = defineTask({
        id: "tracker-deny-internal",
        run: async () => "i",
      });

      tracker.recordOwnership("owner", exported);
      tracker.recordOwnership("owner", internal);
      tracker.recordExports("owner", [exported]);

      expect(tracker.isAccessible("tracker-deny-exported", "external")).toBe(
        true,
      );
      expect(tracker.isAccessible("tracker-deny-internal", "external")).toBe(
        false,
      );
    });

    it("allows transitive visibility via exported resources", () => {
      const deepTask = defineTask({
        id: "tracker-nested-deep",
        run: async () => "deep",
      });
      const middleResource = defineResource({
        id: "tracker-nested-middle",
        register: [],
      });

      tracker.recordOwnership("root", middleResource);
      tracker.recordOwnership("tracker-nested-middle", deepTask);
      tracker.recordExports("tracker-nested-middle", [deepTask]);

      expect(tracker.isAccessible("tracker-nested-deep", "external")).toBe(
        true,
      );

      tracker.recordExports("root", [middleResource]);

      expect(tracker.isAccessible("tracker-nested-deep", "external")).toBe(
        true,
      );
    });

    it("blocks transitive visibility when the child resource does not export the target", () => {
      const deepTask = defineTask({
        id: "tracker-nested-blocked-deep",
        run: async () => "deep",
      });
      const middleResource = defineResource({
        id: "tracker-nested-blocked-middle",
        register: [],
      });

      tracker.recordOwnership("root", middleResource);
      tracker.recordOwnership("tracker-nested-blocked-middle", deepTask);
      tracker.recordExports("tracker-nested-blocked-middle", []);
      tracker.recordExports("root", [middleResource]);

      expect(
        tracker.isAccessible("tracker-nested-blocked-deep", "external"),
      ).toBe(false);
    });
  });

  it("returns the gating export ids without looping on cyclical exported resources", () => {
    const deepTask = defineTask({
      id: "tracker-guard-deep",
      run: async () => "deep",
    });
    const middleResource = defineResource({
      id: "tracker-guard-middle",
      register: [],
    });

    tracker.recordOwnership("root", middleResource);
    tracker.recordOwnership(middleResource.id, deepTask);
    tracker.recordExports("root", [middleResource]);
    tracker.recordExports(middleResource.id, ["root"]);

    expect(
      tracker.getAccessViolation(deepTask.id, "external", "dependencies"),
    ).toEqual({
      kind: "visibility",
      targetOwnerResourceId: middleResource.id,
      exportedIds: [],
    });
  });
});
