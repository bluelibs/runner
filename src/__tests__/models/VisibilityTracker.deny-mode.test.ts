import { defineResource, defineTag, defineTask } from "../../define";
import { VisibilityTracker } from "../../models/VisibilityTracker";
import { scope, subtreeOf } from "../../public";

describe("VisibilityTracker deny mode", () => {
  let tracker: VisibilityTracker;

  beforeEach(() => {
    tracker = new VisibilityTracker();
  });

  it("denies by id for resources in policy scope", () => {
    const owner = defineResource({
      id: "tracker-policy-owner",
    });
    const blockedTask = defineTask({
      id: "tracker-policy-task-blocked",
      run: async () => "blocked",
    });
    const consumerTask = defineTask({
      id: "tracker-policy-task-consumer",
      run: async () => "consumer",
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, blockedTask);
    tracker.recordOwnership(owner.id, consumerTask);
    tracker.recordIsolation(owner.id, {
      deny: [blockedTask],
    });

    expect(tracker.isAccessible(blockedTask.id, consumerTask.id)).toBe(false);
  });

  it("denies by tag for tagged targets and tag dependencies", () => {
    const owner = defineResource({
      id: "tracker-policy-tag-owner",
    });
    const denyTag = defineTag({
      id: "tracker-policy-tag-deny",
    });
    const blockedTask = defineTask({
      id: "tracker-policy-tag-task",
      run: async () => "blocked",
    });
    const consumerTask = defineTask({
      id: "tracker-policy-tag-consumer",
      run: async () => "consumer",
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, blockedTask);
    tracker.recordOwnership(owner.id, consumerTask);
    tracker.recordDefinitionTags(blockedTask.id, [denyTag]);
    tracker.recordIsolation(owner.id, {
      deny: [denyTag],
    });

    expect(tracker.isAccessible(blockedTask.id, consumerTask.id)).toBe(false);
    expect(tracker.isAccessible(denyTag.id, consumerTask.id)).toBe(false);
  });

  it("removes the policy when the deny list is empty", () => {
    const owner = defineResource({
      id: "tracker-policy-clear-owner",
    });
    const task = defineTask({
      id: "tracker-policy-clear-task",
      run: async () => "ok",
    });
    const consumer = defineTask({
      id: "tracker-policy-clear-consumer",
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
      id: "tracker-policy-scope-invalid-owner",
    });
    const task = defineTask({
      id: "tracker-policy-scope-invalid-task",
      run: async () => "ok",
    });
    const consumer = defineTask({
      id: "tracker-policy-scope-invalid-consumer",
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
      id: "tracker-policy-channel-owner",
    });
    const child = defineResource({
      id: "tracker-policy-channel-child",
    });
    const directTask = defineTask({
      id: "tracker-policy-channel-direct-task",
      run: async () => "ok",
    });
    const directIdTask = defineTask({
      id: "tracker-policy-channel-direct-id-task",
      run: async () => "ok",
    });
    const childTask = defineTask({
      id: "tracker-policy-channel-child-task",
      run: async () => "ok",
    });
    const taggedTask = defineTask({
      id: "tracker-policy-channel-tagged-task",
      run: async () => "ok",
    });
    const denyTag = defineTag({
      id: "tracker-policy-channel-tag",
    });
    const consumer = defineTask({
      id: "tracker-policy-channel-consumer",
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
    expect(tracker.isAccessible(taggedTask.id, consumer.id, "middleware")).toBe(
      true,
    );
    expect(
      tracker.isAccessible(taggedTask.id, consumer.id, "dependencies"),
    ).toBe(false);
  });

  it("uses the dependencies channel by default in getAccessViolation", () => {
    const owner = defineResource({ id: "tracker-default-channel-owner" });
    const blocked = defineTask({
      id: "tracker-default-channel-blocked",
      run: async () => "blocked",
    });
    const consumer = defineTask({
      id: "tracker-default-channel-consumer",
      run: async () => "consumer",
    });

    tracker.recordResource(owner.id);
    tracker.recordOwnership(owner.id, blocked);
    tracker.recordOwnership(owner.id, consumer);
    tracker.recordIsolation(owner.id, { deny: [blocked] });

    expect(tracker.getAccessViolation(blocked.id, consumer.id)).toMatchObject({
      kind: "isolate",
      channel: "dependencies",
    });
  });
});
