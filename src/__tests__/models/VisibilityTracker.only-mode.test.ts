import { defineResource, defineTag, defineTask } from "../../define";
import { VisibilityTracker } from "../../models/VisibilityTracker";

describe("VisibilityTracker only mode", () => {
  let tracker: VisibilityTracker;

  beforeEach(() => {
    tracker = new VisibilityTracker();
  });

  it("allows a target that is in the only list", () => {
    const owner = defineResource({ id: "tracker-only-allow-owner" });
    const allowed = defineTask({
      id: "tracker-only-allow-task",
      run: async () => {},
    });
    const consumer = defineTask({
      id: "tracker-only-allow-consumer",
      run: async () => {},
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, consumer);
    tracker.recordIsolation(owner.id, { only: [allowed] });

    expect(tracker.isAccessible(allowed.id, consumer.id)).toBe(true);
  });

  it("blocks a target that is not in the only list", () => {
    const owner = defineResource({ id: "tracker-only-block-owner" });
    const forbidden = defineTask({
      id: "tracker-only-block-task",
      run: async () => {},
    });
    const consumer = defineTask({
      id: "tracker-only-block-consumer",
      run: async () => {},
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, consumer);
    tracker.recordIsolation(owner.id, { only: [] });

    expect(tracker.isAccessible(forbidden.id, consumer.id)).toBe(false);
  });

  it("allows internal items even when they are not in the only list", () => {
    const owner = defineResource({ id: "tracker-only-internal-owner" });
    const internal = defineTask({
      id: "tracker-only-internal-task",
      run: async () => {},
    });
    const consumer = defineTask({
      id: "tracker-only-internal-consumer",
      run: async () => {},
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, internal);
    tracker.recordOwnership(owner.id, consumer);
    tracker.recordIsolation(owner.id, { only: [] });

    expect(tracker.isAccessible(internal.id, consumer.id)).toBe(true);
  });

  it("allows an only-listed tag and targets carrying that tag", () => {
    const owner = defineResource({ id: "tracker-only-tag-owner" });
    const allowedTag = defineTag({ id: "tracker-only-tag-allowed" });
    const taggedTask = defineTask({
      id: "tracker-only-tag-task",
      run: async () => {},
    });
    const consumer = defineTask({
      id: "tracker-only-tag-consumer",
      run: async () => {},
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, consumer);
    tracker.recordDefinitionTags(taggedTask.id, [allowedTag]);
    tracker.recordIsolation(owner.id, { only: [allowedTag] });

    expect(tracker.isAccessible(allowedTag.id, consumer.id)).toBe(true);
    expect(tracker.isAccessible(taggedTask.id, consumer.id)).toBe(true);
  });

  it("blocks a task whose tag is not in the only list", () => {
    const owner = defineResource({ id: "tracker-only-tag-block-owner" });
    const allowedTag = defineTag({ id: "tracker-only-tag-block-allowed" });
    const notAllowedTag = defineTag({
      id: "tracker-only-tag-block-denied",
    });
    const blockedTask = defineTask({
      id: "tracker-only-tag-block-task",
      run: async () => {},
    });
    const consumer = defineTask({
      id: "tracker-only-tag-block-consumer",
      run: async () => {},
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, consumer);
    tracker.recordDefinitionTags(blockedTask.id, [notAllowedTag]);
    tracker.recordIsolation(owner.id, { only: [allowedTag] });

    expect(tracker.isAccessible(blockedTask.id, consumer.id)).toBe(false);
  });
});
