import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { scope, subtreeOf } from "../../public";
import { run } from "../../run";

const POLICY_VIOLATION_ID = "runner.errors.isolationViolation";

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

describe("scope(subtreeOf(...), channels)", () => {
  it("allows listening when listening channel is disabled", async () => {
    const agentEvent = defineEvent({
      id: "subtree-channels-listen-allowed-event",
    });

    const agentResource = defineResource({
      id: "subtree-channels-listen-allowed-agent",
      register: [agentEvent],
    });

    const hookConsumer = defineHook({
      id: "subtree-channels-listen-allowed-hook",
      on: agentEvent,
      run: async () => undefined,
    });

    const boundary = defineResource({
      id: "subtree-channels-listen-allowed-boundary",
      register: [hookConsumer],
      isolate: {
        deny: [scope(subtreeOf(agentResource), { listening: false })],
      },
    });

    const app = defineResource({
      id: "subtree-channels-listen-allowed-app",
      register: [agentResource, boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("still blocks dependencies when only listening is disabled", async () => {
    const agentTask = defineTask({
      id: "subtree-channels-deps-blocked-task",
      run: async () => "agent",
    });

    const agentResource = defineResource({
      id: "subtree-channels-deps-blocked-agent",
      register: [agentTask],
    });

    const consumer = defineTask({
      id: "subtree-channels-deps-blocked-consumer",
      dependencies: { agentTask },
      run: async (_input, deps) => deps.agentTask(),
    });

    const boundary = defineResource({
      id: "subtree-channels-deps-blocked-boundary",
      register: [consumer],
      isolate: {
        deny: [scope(subtreeOf(agentResource), { listening: false })],
      },
    });

    const app = defineResource({
      id: "subtree-channels-deps-blocked-app",
      register: [agentResource, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain("channel: dependencies");
  });
});

describe("scope([subtreeOf(a), subtreeOf(b)], channels)", () => {
  it("allows dependencies when dependencies channel is disabled", async () => {
    const firstTask = defineTask({
      id: "subtree-channels-multi-deps-allowed-first",
      run: async () => "first",
    });
    const secondTask = defineTask({
      id: "subtree-channels-multi-deps-allowed-second",
      run: async () => "second",
    });

    const firstResource = defineResource({
      id: "subtree-channels-multi-deps-allowed-first-resource",
      register: [firstTask],
    });
    const secondResource = defineResource({
      id: "subtree-channels-multi-deps-allowed-second-resource",
      register: [secondTask],
    });

    const consumer = defineTask({
      id: "subtree-channels-multi-deps-allowed-consumer",
      dependencies: { firstTask, secondTask },
      run: async (_input, deps) => [
        await deps.firstTask(),
        await deps.secondTask(),
      ],
    });

    const boundary = defineResource({
      id: "subtree-channels-multi-deps-allowed-boundary",
      register: [consumer],
      isolate: {
        deny: [
          scope([subtreeOf(firstResource), subtreeOf(secondResource)], {
            dependencies: false,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "subtree-channels-multi-deps-allowed-app",
      register: [firstResource, secondResource, boundary],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(consumer)).resolves.toEqual([
      "first",
      "second",
    ]);
    await runtime.dispose();
  });

  it("blocks listening for wrapped subtrees when dependencies channel is disabled", async () => {
    const firstEvent = defineEvent({
      id: "subtree-channels-multi-listen-blocked-first-event",
    });
    const secondEvent = defineEvent({
      id: "subtree-channels-multi-listen-blocked-second-event",
    });

    const firstResource = defineResource({
      id: "subtree-channels-multi-listen-blocked-first-resource",
      register: [firstEvent],
    });
    const secondResource = defineResource({
      id: "subtree-channels-multi-listen-blocked-second-resource",
      register: [secondEvent],
    });

    const hookConsumer = defineHook({
      id: "subtree-channels-multi-listen-blocked-hook",
      on: secondEvent,
      run: async () => undefined,
    });

    const boundary = defineResource({
      id: "subtree-channels-multi-listen-blocked-boundary",
      register: [hookConsumer],
      isolate: {
        deny: [
          scope([subtreeOf(firstResource), subtreeOf(secondResource)], {
            dependencies: false,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "subtree-channels-multi-listen-blocked-app",
      register: [firstResource, secondResource, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain("channel: listening");
  });
});

