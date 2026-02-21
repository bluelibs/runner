import {
  defineEvent,
  defineHook,
  defineResource,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { globalResources } from "../../globals/globalResources";

const POLICY_VIOLATION_ID = "runner.errors.dependencyAccessPolicyViolation";
const POLICY_UNKNOWN_TARGET_ID =
  "runner.errors.dependencyAccessPolicyUnknownTarget";
const POLICY_INVALID_ENTRY_ID =
  "runner.errors.dependencyAccessPolicyInvalidEntry";

async function expectRunnerErrorId(
  promise: Promise<unknown>,
  errorId: string,
): Promise<any> {
  try {
    await promise;
    throw new Error(`Expected error id "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string };
    expect(candidate.id).toBe(errorId);
    return error;
  }
}

describe("run.dependencyAccessPolicy", () => {
  it("fails when a denied id is used as a dependency", async () => {
    const deniedTask = defineTask({
      id: "policy.id.denied",
      run: async () => "denied",
    });

    const consumer = defineTask({
      id: "policy.id.consumer",
      dependencies: { deniedTask },
      run: async (_input, deps) => deps.deniedTask(),
    });

    const guarded = defineResource({
      id: "policy.id.resource",
      register: [deniedTask, consumer],
      dependencyAccessPolicy: {
        deny: [deniedTask.id],
      },
    });

    const app = defineResource({
      id: "policy.id.app",
      register: [guarded],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain(`"${deniedTask.id}"`);
    expect(error.message).toContain(`"${guarded.id}"`);
  });

  it("compounds parent and child policies additively", async () => {
    const deniedTask = defineTask({
      id: "policy.compound.denied",
      run: async () => "nope",
    });

    const consumer = defineTask({
      id: "policy.compound.consumer",
      dependencies: { deniedTask },
      run: async (_input, deps) => deps.deniedTask(),
    });

    const child = defineResource({
      id: "policy.compound.child",
      register: [consumer],
      dependencyAccessPolicy: {
        deny: [consumer.id],
      },
    });

    const parent = defineResource({
      id: "policy.compound.parent",
      register: [deniedTask, child],
      dependencyAccessPolicy: {
        deny: [deniedTask],
      },
    });

    const app = defineResource({
      id: "policy.compound.app",
      register: [parent],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain(`"${parent.id}"`);
  });

  it("blocks explicit hook event subscriptions when denied", async () => {
    const deniedEvent = defineEvent({
      id: "policy.hook.event.denied",
    });

    const hook = defineHook({
      id: "policy.hook.listener",
      on: deniedEvent,
      run: async () => undefined,
    });

    const guarded = defineResource({
      id: "policy.hook.resource",
      register: [deniedEvent, hook],
      dependencyAccessPolicy: {
        deny: [deniedEvent],
      },
    });

    const app = defineResource({
      id: "policy.hook.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("blocks explicit middleware attachments when denied", async () => {
    const deniedMiddleware = defineTaskMiddleware({
      id: "policy.middleware.denied",
      run: async ({ task, next }) => next(task.input),
    });

    const task = defineTask({
      id: "policy.middleware.task",
      middleware: [deniedMiddleware],
      run: async () => "ok",
    });

    const guarded = defineResource({
      id: "policy.middleware.resource",
      register: [deniedMiddleware, task],
      dependencyAccessPolicy: {
        deny: [deniedMiddleware],
      },
    });

    const app = defineResource({
      id: "policy.middleware.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("denying a tag blocks tagged targets and tag dependencies", async () => {
    const deniedTag = defineTag({ id: "policy.tag.denied" });

    const deniedTask = defineTask({
      id: "policy.tag.denied-task",
      tags: [deniedTag],
      run: async () => "nope",
    });

    const deniedTaskConsumer = defineTask({
      id: "policy.tag.consumer",
      dependencies: { deniedTask },
      run: async (_input, deps) => deps.deniedTask(),
    });

    const deniedTagConsumer = defineTask({
      id: "policy.tag.consumer.tag",
      dependencies: { deniedTag },
      run: async (_input, deps) => deps.deniedTag.tasks.length,
    });

    const guarded = defineResource({
      id: "policy.tag.resource",
      register: [deniedTag, deniedTask, deniedTaskConsumer, deniedTagConsumer],
      dependencyAccessPolicy: {
        deny: [deniedTag],
      },
    });

    const app = defineResource({
      id: "policy.tag.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("filters tag accessor results when matched targets are denied by tag", async () => {
    const denyTag = defineTag({ id: "policy.filter.deny" });
    const queryTag = defineTag({ id: "policy.filter.query" });

    const hiddenTask = defineTask({
      id: "policy.filter.hidden-task",
      tags: [denyTag, queryTag],
      run: async () => "hidden",
    });

    const visibleTask = defineTask({
      id: "policy.filter.visible-task",
      tags: [queryTag],
      run: async () => "visible",
    });

    const inspect = defineTask({
      id: "policy.filter.inspect",
      dependencies: { queryTag },
      run: async (_input, deps) =>
        deps.queryTag.tasks.map((entry) => entry.definition.id),
    });

    const guarded = defineResource({
      id: "policy.filter.resource",
      register: [denyTag, queryTag, hiddenTask, visibleTask, inspect],
      dependencyAccessPolicy: {
        deny: [denyTag],
      },
    });

    const app = defineResource({
      id: "policy.filter.app",
      register: [guarded],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(inspect)).resolves.toEqual([visibleTask.id]);
    await runtime.dispose();
  });

  it("fails fast when a deny target id is unknown", async () => {
    const rootInit = jest.fn(async () => "ok");

    const guarded = defineResource({
      id: "policy.unknown.resource",
      dependencyAccessPolicy: {
        deny: ["policy.unknown.missing"],
      },
    });

    const app = defineResource({
      id: "policy.unknown.app",
      register: [guarded],
      init: rootInit,
    });

    await expectRunnerErrorId(run(app), POLICY_UNKNOWN_TARGET_ID);
    expect(rootInit).not.toHaveBeenCalled();
  });

  it("fails fast when a deny entry is invalid", async () => {
    const guarded = defineResource({
      id: "policy.invalid.resource",
      dependencyAccessPolicy: {
        deny: [{} as any],
      },
    });

    const app = defineResource({
      id: "policy.invalid.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_INVALID_ENTRY_ID);
  });

  it("fails fast when deny is not an array", async () => {
    const guarded = defineResource({
      id: "policy.invalid.shape.resource",
      dependencyAccessPolicy: {
        deny: "not-an-array" as any,
      },
    });

    const app = defineResource({
      id: "policy.invalid.shape.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_INVALID_ENTRY_ID);
  });

  it("fails fast when deny contains a non-object primitive", async () => {
    const guarded = defineResource({
      id: "policy.invalid.primitive.resource",
      dependencyAccessPolicy: {
        deny: [123 as any],
      },
    });

    const app = defineResource({
      id: "policy.invalid.primitive.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_INVALID_ENTRY_ID);
  });

  it("fails fast when deny contains an empty string id", async () => {
    const guarded = defineResource({
      id: "policy.invalid.empty-string.resource",
      dependencyAccessPolicy: {
        deny: [""],
      },
    });

    const app = defineResource({
      id: "policy.invalid.empty-string.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_INVALID_ENTRY_ID);
  });

  it("fails fast when deny object id is not a non-empty string", async () => {
    const guarded = defineResource({
      id: "policy.invalid.object-id.resource",
      dependencyAccessPolicy: {
        deny: [{ id: 123 } as any],
      },
    });

    const app = defineResource({
      id: "policy.invalid.object-id.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_INVALID_ENTRY_ID);
  });

  it("accepts resource.with(...) entries in deny", async () => {
    const deniedResource = defineResource<{ label: string }>({
      id: "policy.with.denied-resource",
      init: async (config) => ({ label: config.label }),
    });

    const consumer = defineTask({
      id: "policy.with.consumer",
      dependencies: { deniedResource },
      run: async (_input, deps) => deps.deniedResource.label,
    });

    const guarded = defineResource({
      id: "policy.with.resource",
      register: [deniedResource.with({ label: "x" }), consumer],
      dependencyAccessPolicy: {
        deny: [deniedResource.with({ label: "y" })],
      },
    });

    const app = defineResource({
      id: "policy.with.app",
      register: [guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("ignores internal __runner dependency keys for policy enforcement", async () => {
    const app = defineResource({
      id: "policy.internal.app",
      dependencyAccessPolicy: {
        deny: [globalResources.cron.id],
      },
      init: async () => "ok",
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("ok");
    await runtime.dispose();
  });
});
