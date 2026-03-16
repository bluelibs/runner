import { BootstrapCoordinator } from "../../tools/BootstrapCoordinator";
import { cancellationError } from "../../errors";

describe("BootstrapCoordinator", () => {
  it("starts in initial state", () => {
    const coordinator = new BootstrapCoordinator();
    expect(coordinator.isCompleted).toBe(false);
    expect(coordinator.succeeded).toBe(false);
    expect(coordinator.wasShutdownRequested).toBe(false);
  });

  it("throwIfShutdownRequested is a no-op when no shutdown requested", () => {
    const coordinator = new BootstrapCoordinator();
    expect(() =>
      coordinator.throwIfShutdownRequested("test phase"),
    ).not.toThrow();
  });

  it("throwIfShutdownRequested throws cancellation error after requestShutdown", () => {
    const coordinator = new BootstrapCoordinator();
    coordinator.requestShutdown();
    expect(coordinator.wasShutdownRequested).toBe(true);

    let thrown: unknown;
    try {
      coordinator.throwIfShutdownRequested("test phase");
    } catch (e) {
      thrown = e;
    }
    expect(cancellationError.is(thrown as Error)).toBe(true);
  });

  it("markCompleted(true) advances to completed+succeeded state", () => {
    const coordinator = new BootstrapCoordinator();
    coordinator.markCompleted(true);
    expect(coordinator.isCompleted).toBe(true);
    expect(coordinator.succeeded).toBe(true);
  });

  it("markCompleted(false) advances to completed+failed state", () => {
    const coordinator = new BootstrapCoordinator();
    coordinator.markCompleted(false);
    expect(coordinator.isCompleted).toBe(true);
    expect(coordinator.succeeded).toBe(false);
  });

  it("completion promise resolves after markCompleted", async () => {
    const coordinator = new BootstrapCoordinator();

    let resolved = false;
    const promise = coordinator.completion.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    coordinator.markCompleted(true);
    await promise;
    expect(resolved).toBe(true);
  });

  it("completion promise resolves immediately when already completed", async () => {
    const coordinator = new BootstrapCoordinator();
    coordinator.markCompleted(false);

    // Should resolve without hanging
    await coordinator.completion;
    expect(coordinator.isCompleted).toBe(true);
  });

  it("cancellation error message includes phase name", () => {
    const coordinator = new BootstrapCoordinator();
    coordinator.requestShutdown();

    expect(() =>
      coordinator.throwIfShutdownRequested("override processing"),
    ).toThrow(/override processing/);
  });

  it("preserves the shutdown reason when bootstrap cancellation is external", () => {
    const coordinator = new BootstrapCoordinator();
    coordinator.requestShutdown("outer shutdown");

    expect(() =>
      coordinator.throwIfShutdownRequested("root initialization"),
    ).toThrow(/outer shutdown during bootstrap \(root initialization\)/);
  });
});
