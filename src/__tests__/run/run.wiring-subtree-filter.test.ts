import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { subtreeOf, r } from "../../public";
import { run } from "../../run";

const POLICY_VIOLATION_ID = "isolationViolation";
const POLICY_UNKNOWN_TARGET_ID = "isolationUnknownTarget";

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

describe("subtreeOf() in deny policy", () => {
  it("blocks all items from a resource subtree by default", async () => {
    const agentTask = defineTask({
      id: "deny-all-agent-task",
      run: async () => "agent",
    });

    const consumer = defineTask({
      id: "deny-all-consumer",
      dependencies: { agentTask },
      run: async (_input, deps) => deps.agentTask(),
    });

    const agentResource = defineResource({
      id: "deny-all-agent",
      register: [agentTask],
    });

    const boundary = defineResource({
      id: "deny-all-boundary",
      // subtreeOf matches every item owned by agentResource regardless of id
      isolate: { deny: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "deny-all-app",
      register: [agentResource, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    // The error message should reference the resource that was used as the filter target
    expect(error.message).toContain("deny-all-agent");
  });

  it("only blocks items that match the specified types", async () => {
    const agentTask = defineTask({
      id: "deny-typed-agent-task",
      run: async () => "task",
    });

    const agentEvent = defineEvent<string>({
      id: "deny-typed-agent-event",
    });

    const taskConsumer = defineTask({
      id: "deny-typed-task-consumer",
      dependencies: { agentTask },
      run: async (_input, deps) => deps.agentTask(),
    });

    const hookConsumer = defineHook({
      id: "deny-typed-hook-consumer",
      // Event references are also checked — this should be allowed since we only deny tasks
      on: agentEvent,
      run: async () => {},
    });

    const agentResource = defineResource({
      id: "deny-typed-agent",
      register: [agentTask, agentEvent],
    });

    // Only tasks from agent are denied; events remain accessible
    const boundary = defineResource({
      id: "deny-typed-boundary",
      isolate: { deny: [subtreeOf(agentResource, { types: ["task"] })] },
      register: [taskConsumer, hookConsumer],
    });

    const app = defineResource({
      id: "deny-typed-app",
      register: [agentResource, boundary],
    });

    // Boots up fine — hookConsumer references agentEvent (not a task, not denied)
    // but taskConsumer references agentTask → violation
    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("allows items from the same subtree whose type is NOT in the filter", async () => {
    const agentTask = defineTask({
      id: "deny-passthrough-agent-task",
      run: async () => "task",
    });

    const agentEvent = defineEvent<string>({
      id: "deny-passthrough-agent-event",
    });

    // Only subscribes to the event (not denied because types: ["task"] excludes events)
    const hookConsumer = defineHook({
      id: "deny-passthrough-hook",
      on: agentEvent,
      run: async () => {},
    });

    const agentResource = defineResource({
      id: "deny-passthrough-agent",
      register: [agentTask, agentEvent],
    });

    const boundary = defineResource({
      id: "deny-passthrough-boundary",
      isolate: { deny: [subtreeOf(agentResource, { types: ["task"] })] },
      register: [hookConsumer],
    });

    const app = defineResource({
      id: "deny-passthrough-app",
      register: [agentResource, boundary],
    });

    // hookConsumer depends only on agentEvent, which is NOT in the denied types list
    const runtime = await run(app);
    await runtime.dispose();
  });

  it("catches items registered deep in the subtree even if ids don't share a namespace prefix", async () => {
    // Motivation: overridable ids or items registered by nested child resources
    // will have arbitrary ids — subtreeOf() must still catch them via ownership.
    const deepTask = defineTask({
      id: "any-random-id-task",
      run: async () => "deep",
    });

    const consumer = defineTask({
      id: "deny-deep-consumer",
      dependencies: { deepTask },
      run: async (_input, deps) => deps.deepTask(),
    });

    // Nested inner resource owns deepTask
    const innerAgent = defineResource({
      id: "deny-deep-inner",
      register: [deepTask],
    });

    const agentResource = defineResource({
      id: "deny-deep-agent",
      register: [innerAgent],
    });

    const boundary = defineResource({
      id: "deny-deep-boundary",
      isolate: { deny: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "deny-deep-app",
      register: [agentResource, boundary],
    });

    // deepTask is owned by agentResource's subtree even though id has no shared prefix
    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("matches the resource itself, not only its children", async () => {
    // If a consumer depends directly on the resource definition (e.g. as a dependency value),
    // subtreeOf() should also block that reference.
    const agentResource = defineResource({
      id: "deny-self-agent",
      register: [],
    });

    // Consumer depends on the resource value directly
    const consumer = defineTask({
      id: "deny-self-consumer",
      dependencies: { agentResource },
      run: async (_input, deps) => deps.agentResource,
    });

    const boundary = defineResource({
      id: "deny-self-boundary",
      isolate: { deny: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "deny-self-app",
      register: [agentResource, boundary],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("does not block items outside the denied resource subtree", async () => {
    const agentTask = defineTask({
      id: "deny-outside-agent-task",
      run: async () => "agent",
    });

    // outsideTask lives outside agentResource's subtree — should NOT be blocked
    const outsideTask = defineTask({
      id: "deny-outside-task",
      run: async () => "outside",
    });

    const consumer = defineTask({
      id: "deny-outside-consumer",
      dependencies: { outsideTask },
      run: async (_input, deps) => deps.outsideTask(),
    });

    const agentResource = defineResource({
      id: "deny-outside-agent",
      register: [agentTask],
    });

    const boundary = defineResource({
      id: "deny-outside-boundary",
      isolate: { deny: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "deny-outside-app",
      register: [agentResource, outsideTask, boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });
});

describe("subtreeOf() in only policy", () => {
  it("allows items from the specified resource subtree as external deps", async () => {
    const agentTask = defineTask({
      id: "only-subtree-agent-task",
      run: async () => "agent",
    });

    const consumer = defineTask({
      id: "only-subtree-consumer",
      dependencies: { agentTask },
      run: async (_input, deps) => deps.agentTask(),
    });

    const agentResource = defineResource({
      id: "only-subtree-agent",
      register: [agentTask],
    });

    const boundary = defineResource({
      id: "only-subtree-boundary",
      // Only allow deps from agentResource's subtree (plus internal items)
      isolate: { only: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "only-subtree-app",
      register: [agentResource, boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("blocks items outside the specified subtree", async () => {
    const allowedTask = defineTask({
      id: "only-outside-allowed",
      run: async () => "allowed",
    });

    const blockedTask = defineTask({
      id: "only-outside-blocked",
      run: async () => "blocked",
    });

    const consumer = defineTask({
      id: "only-outside-consumer",
      dependencies: { blockedTask },
      run: async (_input, deps) => deps.blockedTask(),
    });

    const agentResource = defineResource({
      id: "only-outside-agent",
      register: [allowedTask],
    });

    const boundary = defineResource({
      id: "only-outside-boundary",
      isolate: { only: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "only-outside-app",
      register: [blockedTask, agentResource, boundary],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("filters allowed subtree items by type", async () => {
    const agentTask = defineTask({
      id: "only-typed-agent-task",
      run: async () => "task",
    });

    const agentEvent = defineEvent<string>({
      id: "only-typed-agent-event",
    });

    // Tries to use the task — but only events from the subtree are allowed
    const consumer = defineTask({
      id: "only-typed-consumer",
      dependencies: { agentTask },
      run: async (_input, deps) => deps.agentTask(),
    });

    const agentResource = defineResource({
      id: "only-typed-agent",
      register: [agentTask, agentEvent],
    });

    const boundary = defineResource({
      id: "only-typed-boundary",
      isolate: { only: [subtreeOf(agentResource, { types: ["event"] })] },
      register: [consumer],
    });

    const app = defineResource({
      id: "only-typed-app",
      register: [agentResource, boundary],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("allows subtree items whose type matches the type filter", async () => {
    const agentTask = defineTask({
      id: "only-match-agent-task",
      run: async () => "matched",
    });

    const consumer = defineTask({
      id: "only-match-consumer",
      dependencies: { agentTask },
      run: async (_input, deps) => deps.agentTask(),
    });

    const agentResource = defineResource({
      id: "only-match-agent",
      register: [agentTask],
    });

    // types: ["task"] means tasks from the subtree are allowed — agentTask qualifies
    const boundary = defineResource({
      id: "only-match-boundary",
      isolate: { only: [subtreeOf(agentResource, { types: ["task"] })] },
      register: [consumer],
    });

    const app = defineResource({
      id: "only-match-app",
      register: [agentResource, boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("always allows internal items regardless of subtreeOf filter", async () => {
    const externalTask = defineTask({
      id: "only-internal-external",
      run: async () => "external",
    });

    const internalTask = defineTask({
      id: "only-internal-task",
      run: async () => "internal",
    });

    const consumer = defineTask({
      id: "only-internal-consumer",
      dependencies: { internalTask },
      run: async (_input, deps) => deps.internalTask(),
    });

    const agentResource = defineResource({
      id: "only-internal-agent",
      // externalTask is owned by agentResource — not by boundary
      register: [externalTask],
    });

    const boundary = defineResource({
      id: "only-internal-boundary",
      // only wraps agentResource, but internalTask is registered here — always allowed
      isolate: { only: [subtreeOf(agentResource)] },
      register: [internalTask, consumer],
    });

    const app = defineResource({
      id: "only-internal-app",
      // agentResource already registers externalTask — don't re-register it here
      register: [agentResource, boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });
});

describe("subtreeOf() includes the resource itself", () => {
  it("matches the resource itself in only mode", async () => {
    const agentResource = defineResource({
      id: "only-self-agent",
      register: [],
    });

    // Trying to use a resource that is NOT in the allowed subtree
    const outsideResource = defineResource({
      id: "only-self-outside",
      register: [],
    });

    const consumer = defineTask({
      id: "only-self-consumer",
      dependencies: { outsideResource },
      run: async (_input, deps) => deps.outsideResource,
    });

    const boundary = defineResource({
      id: "only-self-boundary",
      // only agentResource (and its subtree) is allowed — outsideResource is not
      isolate: { only: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "only-self-app",
      register: [agentResource, outsideResource, boundary],
    });

    await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
  });

  it("allows the resource itself when it is in the only subtreeOf list", async () => {
    const agentResource = defineResource({
      id: "only-self-allowed-agent",
      register: [],
    });

    const consumer = defineTask({
      id: "only-self-allowed-consumer",
      dependencies: { agentResource },
      run: async (_input, deps) => deps.agentResource,
    });

    const boundary = defineResource({
      id: "only-self-allowed-boundary",
      isolate: { only: [subtreeOf(agentResource)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "only-self-allowed-app",
      register: [agentResource, boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });
});

describe("subtreeOf() validation", () => {
  it("fails fast when the referenced resource is not registered", async () => {
    const orphan = defineResource({
      id: "subtree-orphan-agent",
      register: [],
    });

    const boundary = defineResource({
      id: "subtree-orphan-boundary",
      isolate: { deny: [subtreeOf(orphan)] },
      register: [],
    });

    // orphan is not registered in the app tree
    const app = defineResource({
      id: "subtree-orphan-app",
      register: [boundary],
    });

    await expectRunnerErrorId(run(app), POLICY_UNKNOWN_TARGET_ID);
  });
});

describe("subtreeOf() API surface", () => {
  it("is accessible via r.subtreeOf()", () => {
    const res = defineResource({ id: "r-api-res" });
    const filter = r.subtreeOf(res, { types: ["task"] });
    expect(filter._subtreeFilter).toBe(true);
    expect(filter.resourceId).toBe("r-api-res");
    expect(filter.types).toEqual(["task"]);
  });

  it("omitting types means all item types are matched", () => {
    const res = defineResource({ id: "r-api-notypes" });
    const filter = subtreeOf(res);
    expect(filter.types).toBeUndefined();
  });
});
