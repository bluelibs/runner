import test from "node:test";
import assert from "node:assert/strict";
import type { Execution, StepResult } from "@bluelibs/runner/node";
import { getWorkflow } from "./workflows/catalog.js";
import {
  computeReachableNodeIds,
  describePosition,
  isTerminalStatus,
  projectTimeline,
} from "./server/timeline.js";

const onboarding = getWorkflow("userOnboarding")!;

function execution(overrides: Partial<Execution>): Execution {
  return {
    id: "exec_1",
    workflowKey: "userOnboarding",
    input: { email: "a@b.c", plan: "pro" },
    status: "running",
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:01Z"),
    ...overrides,
  };
}

function step(stepId: string, result: unknown): StepResult {
  return {
    executionId: "exec_1",
    stepId,
    result,
    completedAt: new Date("2026-01-01T00:00:01Z"),
  };
}

function stateOf(
  exec: Execution,
  steps: StepResult[],
  stepId: string,
): string {
  const node = projectTimeline(onboarding, exec, steps).find(
    (entry) => entry.id === stepId,
  );
  assert.ok(node, `timeline includes ${stepId}`);
  return node.state;
}

test("terminal statuses match the engine lifecycle", () => {
  assert.equal(isTerminalStatus("completed"), true);
  assert.equal(isTerminalStatus("failed"), true);
  assert.equal(isTerminalStatus("cancelled"), true);
  assert.equal(isTerminalStatus("compensation_failed"), true);
  assert.equal(isTerminalStatus("continued_as_new"), true);
  assert.equal(isTerminalStatus("running"), false);
  assert.equal(isTerminalStatus("sleeping"), false);
  assert.equal(isTerminalStatus("pending"), false);
  assert.equal(isTerminalStatus("paused"), false);
});

test("live signal wait surfaces waiting state with countdown metadata", () => {
  const exec = execution({
    status: "sleeping",
    current: {
      kind: "waitForSignal",
      stepId: "__signal:awaitEmailVerification",
      startedAt: new Date(),
      waitingFor: {
        type: "signal",
        params: {
          signalId: "emailVerified",
          timeoutMs: 15_000,
          timeoutAtMs: 1_700_000_000_000,
        },
      },
    },
  });
  const nodes = projectTimeline(onboarding, exec, [
    step("createAccount", { userId: "u1" }),
    step("sendVerificationEmail", { sentAt: 1 }),
    step("__signal:awaitEmailVerification", {
      state: "waiting",
      signalId: "emailVerified",
      timeoutMs: 15_000,
      timeoutAtMs: 1_700_000_000_000,
      timerId: "t1",
    }),
  ]);
  const waiting = nodes.find(
    (node) => node.id === "__signal:awaitEmailVerification",
  )!;
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.wait?.signalId, "emailVerified");
  assert.equal(waiting.wait?.timeoutAtMs, 1_700_000_000_000);
  assert.equal(stateOf(exec, [], "createAccount"), "pending");
  const completed = projectTimeline(onboarding, exec, [
    step("createAccount", { userId: "u1" }),
  ]);
  assert.equal(
    completed.find((node) => node.id === "createAccount")!.state,
    "completed",
  );
});

test("evaluated switch takes its branch and skips the other path", () => {
  const exec = execution({ status: "completed" });
  const nodes = projectTimeline(onboarding, exec, [
    step("createAccount", {}),
    step("sendVerificationEmail", {}),
    step("__signal:awaitEmailVerification", { state: "timed_out" }),
    step("provisionBranch", { branchId: "timed-out", result: null }),
    step("sendWelcomeEmail", {}),
  ]);
  const branch = nodes.find((node) => node.id === "provisionBranch")!;
  assert.equal(branch.state, "completed");
  assert.equal(branch.branchTaken, "timed-out");
  assert.equal(
    nodes.find((node) => node.id === "provisionResources")!.state,
    "skipped",
  );
  assert.equal(
    nodes.find((node) => node.id === "sendWelcomeEmail")!.state,
    "completed",
  );
});

test("taken branches prune reachability for live executions", () => {
  const all = computeReachableNodeIds(onboarding, new Map());
  assert.ok(all.has("provisionResources"));
  const pruned = computeReachableNodeIds(
    onboarding,
    new Map([["provisionBranch", "timed-out"]]),
  );
  assert.ok(!pruned.has("provisionResources"));
  assert.ok(pruned.has("sendWelcomeEmail"));
});

test("failed execution pinpoints the live step that threw", () => {
  const exec = execution({
    status: "failed",
    error: { message: "boom" },
    current: {
      kind: "step",
      stepId: "sendVerificationEmail",
      startedAt: new Date(),
    },
  });
  const steps = [step("createAccount", {})];
  assert.equal(stateOf(exec, steps, "sendVerificationEmail"), "failed");
  assert.equal(stateOf(exec, steps, "createAccount"), "completed");
  assert.equal(
    stateOf(exec, steps, "__signal:awaitEmailVerification"),
    "unreached",
  );
});

test("failed execution without position falls back to the first gap", () => {
  const exec = execution({
    status: "failed",
    error: { message: "boom" },
    current: undefined,
  });
  const steps = [step("createAccount", {})];
  assert.equal(stateOf(exec, steps, "sendVerificationEmail"), "failed");
});

test("failed execution prefers the recorded failed step id", () => {
  const exec = execution({
    status: "failed",
    error: { message: "boom", stepId: "sendVerificationEmail" },
    current: undefined,
  });
  const steps = [step("createAccount", {})];

  assert.equal(stateOf(exec, steps, "sendVerificationEmail"), "failed");
  assert.equal(
    describePosition(exec, steps, onboarding),
    "Failed at `sendVerificationEmail`: boom",
  );
});

test("stale wait markers on terminal executions are not waiting", () => {
  const exec = execution({ status: "cancelled", current: undefined });
  const steps = [
    step("createAccount", {}),
    step("__signal:awaitEmailVerification", {
      state: "waiting",
      signalId: "emailVerified",
    }),
  ];
  assert.equal(
    stateOf(exec, steps, "__signal:awaitEmailVerification"),
    "unreached",
  );
});

test("unknown persisted steps surface as extra completed nodes", () => {
  const exec = execution({ status: "completed" });
  const nodes = projectTimeline(onboarding, exec, [
    step("createAccount", {}),
    step("mysteryStep", { ok: true }),
  ]);
  const extra = nodes.find((node) => node.id === "mysteryStep")!;
  assert.equal(extra.state, "completed");
  assert.deepEqual(extra.result, { ok: true });
});

test("position lines describe every suspension kind", () => {
  assert.equal(
    describePosition(
      execution({ status: "completed", current: undefined }),
      [],
    ),
    "Completed",
  );
  assert.equal(
    describePosition(
      execution({
        status: "failed",
        error: { message: "nope" },
        current: { kind: "step", stepId: "diagnose", startedAt: new Date() },
      }),
      [],
    ),
    "Failed at `diagnose`: nope",
  );
  assert.equal(
    describePosition(
      execution({ status: "cancelled", current: undefined }),
      [],
    ),
    "Cancelled",
  );
  assert.equal(
    describePosition(
      execution({ status: "continued_as_new", current: undefined }),
      [],
    ),
    "Continued as new",
  );
  assert.equal(
    describePosition(execution({ status: "paused", current: undefined }), []),
    "Paused",
  );
  assert.equal(
    describePosition(
      execution({
        status: "running",
        current: {
          kind: "waitForSignal",
          stepId: "__signal:x",
          startedAt: new Date(),
          waitingFor: { type: "signal", params: { signalId: "emailVerified" } },
        },
      }),
      [],
    ),
    "Waiting for signal `emailVerified`",
  );
  assert.equal(
    describePosition(
      execution({
        status: "sleeping",
        current: {
          kind: "sleep",
          stepId: "__sleep:processingDelay",
          startedAt: new Date(),
          waitingFor: {
            type: "sleep",
            params: { fireAtMs: 1, timerId: "t", durationMs: 1 },
          },
        },
      }),
      [],
    ),
    "Sleeping at `__sleep:processingDelay`",
  );
  assert.equal(
    describePosition(
      execution({
        status: "running",
        current: { kind: "step", stepId: "diagnose", startedAt: new Date() },
      }),
      [],
    ),
    "Running step `diagnose`",
  );
  assert.equal(
    describePosition(
      execution({
        status: "running",
        current: { kind: "switch", stepId: "ackBranch", startedAt: new Date() },
      }),
      [],
    ),
    "Evaluating branch `ackBranch`",
  );
  assert.equal(
    describePosition(
      execution({
        status: "running",
        current: {
          kind: "waitForExecution",
          stepId: "w",
          startedAt: new Date(),
          waitingFor: {
            type: "execution",
            params: {
              targetExecutionId: "exec_9",
              targetWorkflowKey: "child",
            },
          },
        },
      }),
      [],
    ),
    "Waiting for execution `exec_9`",
  );
  assert.equal(
    describePosition(
      execution({ status: "retrying", current: undefined }),
      [],
    ),
    "Retrying",
  );
  assert.equal(
    describePosition(
      execution({ status: "cancelling", current: undefined }),
      [],
    ),
    "Cancelling",
  );
  assert.equal(
    describePosition(execution({ status: "pending", current: undefined }), []),
    null,
  );
});

test("positions derive from persisted markers without a live pointer", () => {
  const waiting = execution({ status: "sleeping", current: undefined });
  assert.equal(
    describePosition(
      waiting,
      [
        step("__signal:awaitEmailVerification", {
          state: "waiting",
          signalId: "emailVerified",
        }),
      ],
      onboarding,
    ),
    "Waiting for signal `emailVerified`",
  );
  assert.equal(
    describePosition(waiting, [
      step("__sleep:processingDelay", { state: "sleeping", fireAtMs: 1 }),
    ]),
    "Sleeping at `__sleep:processingDelay`",
  );
  const failed = execution({
    status: "failed",
    error: { message: "boom" },
    current: undefined,
  });
  assert.equal(
    describePosition(failed, [step("createAccount", {})], onboarding),
    "Failed at `sendVerificationEmail`: boom",
  );
  assert.equal(describePosition(failed, []), "Failed: boom");
  const running = execution({ status: "running", current: undefined });
  assert.equal(
    describePosition(running, [], onboarding),
    "Running step `createAccount`",
  );
  assert.equal(
    describePosition(
      running,
      [
        step("createAccount", {}),
        step("sendVerificationEmail", {}),
        step("__signal:awaitEmailVerification", { state: "completed" }),
      ],
      onboarding,
    ),
    "Evaluating branch `provisionBranch`",
  );
});
