import { getPlatform } from "../../platform";
import {
  __resetProcessHooksForTests,
  __waitForProcessHooksIdleForTests,
} from "../../tools/processShutdownHooks";
import { createRunShutdownController } from "../../tools/runShutdownController";
import type { Logger } from "../../models/Logger";
import type { RunResult } from "../../models/RunResult";

function createLoggerDouble(): Logger {
  const logger: Partial<Logger> = {};
  logger.with = jest.fn(() => logger as Logger);

  return logger as unknown as Logger;
}

function createController() {
  const runtimeDispose = jest.fn(async () => undefined);
  const logger = createLoggerDouble();

  const controller = createRunShutdownController({
    store: {
      beginCoolingDown: jest.fn(),
      beginDisposing: jest.fn(),
      cooldown: jest.fn(async () => undefined),
      beginDrained: jest.fn(),
      waitForDrain: jest.fn(async () => true),
      abortInFlightTaskSignals: jest.fn(),
      resolveRegisteredDefinition: jest.fn((definition) => definition),
      dispose: jest.fn(async () => undefined),
    },
    eventManager: {
      emitLifecycle: jest.fn(async () => undefined),
    },
    logger,
    runtime: {
      dispose: runtimeDispose,
    } as unknown as RunResult<unknown>,
    dispose: {
      totalBudgetMs: 100,
      drainingBudgetMs: 50,
      cooldownWindowMs: 10,
    },
    shutdownHooks: true,
    onUnhandledError: jest.fn(),
    takeUnhookProcessSafetyNets: () => undefined,
    onBeforeDisposeAll: jest.fn(),
  });

  return {
    controller,
    runtimeDispose,
  };
}

describe("runShutdownController", () => {
  afterEach(() => {
    __resetProcessHooksForTests();
    jest.restoreAllMocks();
  });

  it("does not dispose the runtime when bootstrap shutdown finishes unsuccessfully", async () => {
    const exitSpy = jest
      .spyOn(getPlatform(), "exit")
      .mockImplementation(() => undefined);
    const { controller, runtimeDispose } = createController();

    process.emit("SIGTERM");
    await Promise.resolve();
    controller.bootstrap.markCompleted(false);
    await __waitForProcessHooksIdleForTests();

    expect(runtimeDispose).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("disposes the runtime once bootstrap shutdown finishes successfully", async () => {
    const exitSpy = jest
      .spyOn(getPlatform(), "exit")
      .mockImplementation(() => undefined);
    const { controller, runtimeDispose } = createController();

    process.emit("SIGTERM");
    await Promise.resolve();
    controller.bootstrap.markCompleted(true);
    await __waitForProcessHooksIdleForTests();

    expect(runtimeDispose).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exposes force-disposal state through the controller facade", () => {
    const { controller } = createController();

    expect(controller.isForceDisposeRequested()).toBe(false);
    controller.requestForceDispose();
    expect(controller.isForceDisposeRequested()).toBe(true);
  });
});
