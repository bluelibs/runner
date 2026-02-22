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

const POLICY_VIOLATION_ID = "runner.errors.wiringAccessPolicyViolation";
const POLICY_UNKNOWN_TARGET_ID =
  "runner.errors.wiringAccessPolicyUnknownTarget";
const POLICY_INVALID_ENTRY_ID = "runner.errors.wiringAccessPolicyInvalidEntry";
const POLICY_CONFLICT_ID = "runner.errors.wiringAccessPolicyConflict";

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

describe("run.wiringAccessPolicy", () => {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
        deny: [consumer.id],
      },
    });

    const parent = defineResource({
      id: "policy.compound.parent",
      register: [deniedTask, child],
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
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
      wiringAccessPolicy: {
        deny: [globalResources.cron.id],
      },
      init: async () => "ok",
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("ok");
    await runtime.dispose();
  });
});

describe("run.wiringAccessPolicy (only mode)", () => {
  it("allows a dependency that is in the only list", async () => {
    const allowed = defineTask({
      id: "only.allowed.task",
      run: async () => 42,
    });

    const consumer = defineTask({
      id: "only.allowed.consumer",
      dependencies: { allowed },
      run: async (_input, deps) => deps.allowed(),
    });

    const guarded = defineResource({
      id: "only.allowed.resource",
      register: [allowed, consumer],
      wiringAccessPolicy: { only: [allowed] },
    });

    const app = defineResource({ id: "only.allowed.app", register: [guarded] });
    const runtime = await run(app);
    await runtime.dispose();
  });

  it("blocks a dependency that is not in the only list", async () => {
    const forbidden = defineTask({
      id: "only.blocked.forbidden",
      run: async () => "secret",
    });

    const consumer = defineTask({
      id: "only.blocked.consumer",
      dependencies: { forbidden },
      run: async (_input, deps) => deps.forbidden(),
    });

    const guarded = defineResource({
      id: "only.blocked.resource",
      register: [consumer],
      wiringAccessPolicy: { only: [] },
    });

    const app = defineResource({
      id: "only.blocked.app",
      register: [forbidden, guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("allows internal items without listing them in only", async () => {
    const internal = defineTask({
      id: "only.internal.task",
      run: async () => "internal",
    });

    const consumer = defineTask({
      id: "only.internal.consumer",
      dependencies: { internal },
      run: async (_input, deps) => deps.internal(),
    });

    const guarded = defineResource({
      id: "only.internal.resource",
      // internal and consumer are registered here — they are internal and always allowed.
      register: [internal, consumer],
      wiringAccessPolicy: { only: [] },
    });

    const app = defineResource({
      id: "only.internal.app",
      register: [guarded],
    });
    const runtime = await run(app);
    await runtime.dispose();
  });

  it("allows only-listed tag members and blocks others", async () => {
    const safeTag = defineTag({ id: "only.tag.safe" });
    const dangerTag = defineTag({ id: "only.tag.danger" });

    const safeTask = defineTask({
      id: "only.tag.safeTask",
      tags: [safeTag],
      run: async () => "safe",
    });

    const dangerTask = defineTask({
      id: "only.tag.dangerTask",
      tags: [dangerTag],
      run: async () => "danger",
    });

    const consumer = defineTask({
      id: "only.tag.consumer",
      dependencies: { dangerTask },
      run: async (_input, deps) => deps.dangerTask(),
    });

    const guarded = defineResource({
      id: "only.tag.resource",
      register: [safeTask, consumer],
      // only tasks tagged with safeTag are allowed externally
      wiringAccessPolicy: { only: [safeTag] },
    });

    const app = defineResource({
      id: "only.tag.app",
      register: [dangerTag, safeTag, dangerTask, guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("fails fast when both deny and only are provided", async () => {
    const someTask = defineTask({ id: "conflict.task", run: async () => {} });

    const guarded = defineResource({
      id: "conflict.resource",
      register: [someTask],
      wiringAccessPolicy: {
        deny: [someTask.id],
        only: [someTask.id],
      } as any,
    });

    const app = defineResource({ id: "conflict.app", register: [guarded] });
    await expectRunnerErrorId(run(app), POLICY_CONFLICT_ID);
  });

  it("fails fast when deny is empty array alongside only (field presence, not length)", async () => {
    const someTask = defineTask({
      id: "conflict.empty-deny.task",
      run: async () => {},
    });

    const guarded = defineResource({
      id: "conflict.empty-deny.resource",
      register: [someTask],
      // deny: [] is a no-op semantically, but mixing both fields is still ambiguous.
      wiringAccessPolicy: {
        deny: [],
        only: [someTask.id],
      } as any,
    });

    const app = defineResource({
      id: "conflict.empty-deny.app",
      register: [guarded],
    });
    await expectRunnerErrorId(run(app), POLICY_CONFLICT_ID);
  });

  it("fails fast when only contains an unknown target", async () => {
    const guarded = defineResource({
      id: "only.unknown.resource",
      wiringAccessPolicy: { only: ["does.not.exist"] },
    });

    const app = defineResource({ id: "only.unknown.app", register: [guarded] });
    await expectRunnerErrorId(run(app), POLICY_UNKNOWN_TARGET_ID);
  });

  it("fails fast when only contains an invalid entry", async () => {
    const guarded = defineResource({
      id: "only.invalid.resource",
      wiringAccessPolicy: { only: [123 as any] },
    });

    const app = defineResource({ id: "only.invalid.app", register: [guarded] });
    await expectRunnerErrorId(run(app), POLICY_INVALID_ENTRY_ID);
  });

  it("fails fast when only is not an array", async () => {
    const guarded = defineResource({
      id: "only.invalid-shape.resource",
      wiringAccessPolicy: { only: "not-an-array" as any },
    });

    const app = defineResource({
      id: "only.invalid-shape.app",
      register: [guarded],
    });
    await expectRunnerErrorId(run(app), POLICY_INVALID_ENTRY_ID);
  });

  it("only is inherited by child resource items", async () => {
    const allowed = defineTask({
      id: "only.child.allowed",
      run: async () => "allowed",
    });

    const blocked = defineTask({
      id: "only.child.blocked",
      run: async () => "blocked",
    });

    const consumer = defineTask({
      id: "only.child.consumer",
      dependencies: { blocked },
      run: async (_input, deps) => deps.blocked(),
    });

    const child = defineResource({
      id: "only.child.child",
      register: [consumer],
    });

    const guarded = defineResource({
      id: "only.child.guarded",
      register: [child],
      wiringAccessPolicy: { only: [allowed] },
    });

    const app = defineResource({
      id: "only.child.app",
      register: [allowed, blocked, guarded],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });
});
