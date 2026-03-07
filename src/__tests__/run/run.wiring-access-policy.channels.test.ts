import {
  defineEvent,
  defineHook,
  defineResource,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { scope } from "../../public";
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

describe("run.isolate channels (deny mode)", () => {
  it("denies dependency wiring when dependencies channel is enabled", async () => {
    const deniedTask = defineTask({
      id: "channels-deny-dependencies-target",
      run: async () => "denied",
    });

    const consumer = defineTask({
      id: "channels-deny-dependencies-consumer",
      dependencies: { deniedTask },
      run: async (_input, deps) => deps.deniedTask(),
    });

    const boundary = defineResource({
      id: "channels-deny-dependencies-boundary",
      register: [consumer],
      isolate: {
        deny: [
          scope(deniedTask, {
            dependencies: true,
            listening: false,
            tagging: false,
            middleware: false,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "channels-deny-dependencies-app",
      register: [deniedTask, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain("channel: dependencies");
  });

  it("allows hook subscriptions when listening channel is disabled", async () => {
    const event = defineEvent({
      id: "channels-deny-listening-allowed-event",
    });

    const hook = defineHook({
      id: "channels-deny-listening-allowed-hook",
      on: event,
      run: async () => undefined,
    });

    const boundary = defineResource({
      id: "channels-deny-listening-allowed-boundary",
      register: [hook],
      isolate: {
        deny: [scope(event, { listening: false })],
      },
    });

    const app = defineResource({
      id: "channels-deny-listening-allowed-app",
      register: [event, boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("denies hook subscriptions when listening channel is enabled", async () => {
    const event = defineEvent({
      id: "channels-deny-listening-blocked-event",
    });

    const hook = defineHook({
      id: "channels-deny-listening-blocked-hook",
      on: event,
      run: async () => undefined,
    });

    const boundary = defineResource({
      id: "channels-deny-listening-blocked-boundary",
      register: [hook],
      isolate: {
        deny: [
          scope(event, {
            dependencies: false,
            listening: true,
            tagging: false,
            middleware: false,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "channels-deny-listening-blocked-app",
      register: [event, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain("channel: listening");
  });

  it("denies middleware attachments when middleware channel is enabled", async () => {
    const deniedMiddleware = defineTaskMiddleware({
      id: "channels-deny-middleware-blocked-middleware",
      run: async ({ task, next }) => next(task.input),
    });

    const task = defineTask({
      id: "channels-deny-middleware-blocked-task",
      middleware: [deniedMiddleware],
      run: async () => "ok",
    });

    const boundary = defineResource({
      id: "channels-deny-middleware-blocked-boundary",
      register: [task],
      isolate: {
        deny: [
          scope(deniedMiddleware, {
            dependencies: false,
            listening: false,
            tagging: false,
            middleware: true,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "channels-deny-middleware-blocked-app",
      register: [deniedMiddleware, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain("channel: middleware");
  });

  it("denies tag attachments when tagging channel is enabled", async () => {
    const deniedTag = defineTag({
      id: "channels-deny-tagging-blocked-tag",
    });

    const taggedTask = defineTask({
      id: "channels-deny-tagging-blocked-task",
      tags: [deniedTag],
      run: async () => "ok",
    });

    const boundary = defineResource({
      id: "channels-deny-tagging-blocked-boundary",
      register: [taggedTask],
      isolate: {
        deny: [
          scope(deniedTag, {
            dependencies: false,
            listening: false,
            tagging: true,
            middleware: false,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "channels-deny-tagging-blocked-app",
      register: [deniedTag, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain("channel: tagging");
  });
});

describe("run.isolate channels (only mode)", () => {
  it("allows dependencies while other channels are disabled on the same scope entry", async () => {
    const allowedTask = defineTask({
      id: "channels-only-dependencies-allowed-task",
      run: async () => "allowed",
    });

    const consumer = defineTask({
      id: "channels-only-dependencies-allowed-consumer",
      dependencies: { allowedTask },
      run: async (_input, deps) => deps.allowedTask(),
    });

    const boundary = defineResource({
      id: "channels-only-dependencies-allowed-boundary",
      register: [consumer],
      isolate: {
        only: [
          scope(allowedTask, {
            dependencies: true,
            listening: false,
            tagging: false,
            middleware: false,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "channels-only-dependencies-allowed-app",
      register: [allowedTask, boundary],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(consumer)).resolves.toBe("allowed");
    await runtime.dispose();
  });

  it("blocks listening when only scope entry disables listening channel", async () => {
    const allowedTask = defineTask({
      id: "channels-only-listening-blocked-anchor-task",
      run: async () => "allowed",
    });

    const blockedEvent = defineEvent({
      id: "channels-only-listening-blocked-event",
    });

    const hook = defineHook({
      id: "channels-only-listening-blocked-hook",
      on: blockedEvent,
      run: async () => undefined,
    });

    const boundary = defineResource({
      id: "channels-only-listening-blocked-boundary",
      register: [hook],
      isolate: {
        only: [
          scope(allowedTask, {
            dependencies: true,
            listening: false,
            tagging: false,
            middleware: false,
          }),
        ],
      },
    });

    const app = defineResource({
      id: "channels-only-listening-blocked-app",
      register: [allowedTask, blockedEvent, boundary],
    });

    const error = await expectRunnerErrorId(run(app), POLICY_VIOLATION_ID);
    expect(error.message).toContain("channel: listening");
  });
});
