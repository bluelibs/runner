import { createRuntimeServices } from "../../tools/createRuntimeServices";
import { ResourceLifecycleMode } from "../../types/runner";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { Logger, PrintStrategy } from "../../models/Logger";
import { TaskRunner } from "../../models/TaskRunner";
import { DependencyProcessor } from "../../models/DependencyProcessor";

const defaults = {
  lifecycleMode: ResourceLifecycleMode.Sequential,
  executionContextConfig: null,
  lazy: false,
  errorBoundary: false,
  printThreshold: null,
  printStrategy: "plain" as PrintStrategy,
  bufferLogs: false,
};

describe("createRuntimeServices", () => {
  it("returns all expected service instances", () => {
    const services = createRuntimeServices(defaults);

    expect(services.logger).toBeInstanceOf(Logger);
    expect(services.store).toBeInstanceOf(Store);
    expect(services.eventManager).toBeInstanceOf(EventManager);
    expect(services.taskRunner).toBeInstanceOf(TaskRunner);
    expect(services.processor).toBeInstanceOf(DependencyProcessor);
    expect(services.onUnhandledError).toBeInstanceOf(Function);
  });

  it("does not register process safety nets when errorBoundary is false", () => {
    const services = createRuntimeServices(defaults);
    expect(services.unhookProcessSafetyNets).toBeUndefined();
  });

  it("registers process safety nets when errorBoundary is true", () => {
    const services = createRuntimeServices({
      ...defaults,
      errorBoundary: true,
    });
    expect(services.unhookProcessSafetyNets).toBeInstanceOf(Function);
    // Clean up the hooks
    services.unhookProcessSafetyNets!();
  });

  it("uses custom onUnhandledError when provided", () => {
    const customHandler = jest.fn();
    const services = createRuntimeServices({
      ...defaults,
      onUnhandledError: customHandler,
    });
    expect(services.onUnhandledError).toBe(customHandler);
  });

  it("uses default onUnhandledError when none provided", () => {
    const services = createRuntimeServices(defaults);
    // Should be a function (the default wrapper around Logger)
    expect(services.onUnhandledError).toBeInstanceOf(Function);
  });

  it("produces isolated services on each call", () => {
    const a = createRuntimeServices(defaults);
    const b = createRuntimeServices(defaults);

    expect(a.store).not.toBe(b.store);
    expect(a.eventManager).not.toBe(b.eventManager);
    expect(a.logger).not.toBe(b.logger);
    expect(a.taskRunner).not.toBe(b.taskRunner);
    expect(a.processor).not.toBe(b.processor);
  });
});
