import { DurableContext } from "../../../../durable/core/DurableContext";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import { pendingExecution } from "../../helpers/DurableService.unit.helpers";
import { AsyncLocalStorage } from "node:async_hooks";
import { r, resources, tags } from "../../../..";
import { DurableResource } from "../../../../durable/core/DurableResource";
import { DurableService } from "../../../../durable/core/DurableService";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import { commandFixture } from "../managers/command.helpers";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";

describe("command facade integration boundaries", () => {
  it("supports standalone services, rejects self-await, and preserves legacy adapters", async () => {
    const f = await commandFixture();
    const service = new DurableService({ ...f.config, tasks: [f.workflow] });
    const contexts = new AsyncLocalStorage<IDurableContext>();
    const resource = new DurableResource(service, contexts, f.store);
    try {
      expect(await resource.command("run", f.command, 1)).toBe(7);
      const context = { executionId: "run" } as IDurableContext;
      await expect(
        contexts.run(context, () => resource.command("run", f.command, 1)),
      ).rejects.toThrow("targeting itself");
      await f.store.saveExecution(
        pendingExecution({
          id: "root",
          status: "continued_as_new",
          continuedAsExecutionId: "run",
        }),
      );
      const fullContext = new DurableContext(
        f.store,
        new NoopEventBus(),
        "run",
        1,
      );
      await expect(
        contexts.run(fullContext, () => resource.command("root", f.command, 1)),
      ).rejects.toThrow("targeting itself");
      const otherContext = new DurableContext(
        f.store,
        new NoopEventBus(),
        "other",
        1,
      );
      expect(
        await contexts.run(otherContext, () =>
          resource.command("root", f.command, 1),
        ),
      ).toBe(7);
      await expect(
        contexts.run(otherContext, () =>
          resource.command("missing", f.command, 1),
        ),
      ).rejects.toThrow("does not exist");
      Object.defineProperty(service, "command", { value: undefined });
      await expect(resource.command("run", f.command, 1)).rejects.toThrow(
        "does not support",
      );
    } finally {
      await service.stop();
    }
  });

  it("fails before admission when a declared command is missing from the Runner graph", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const missing = r
      .task("missing")
      .run(async () => 1)
      .build();
    const registered = r
      .task("registered")
      .run(async () => 1)
      .build();
    const workflow = r
      .task("workflow")
      .tags([tags.durableWorkflow.with({ commands: [missing] })])
      .dependencies({ durable })
      .run(async (_: undefined, { durable }) => {
        await durable.use().sleep(100);
        return 1;
      })
      .build();
    await test.run(
      r
        .resource("app")
        .register([
          resources.durable,
          registered,
          workflow,
          test.durableRegistration,
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const id = await test.backend.start(workflow);
      await expect(
        test.backend.command(id, registered, undefined),
      ).rejects.toThrow("not found");
      expect(await test.store.getNextCommand(id)).toBeNull();
    } finally {
      await test.dispose();
    }
  });

  it.each(["paused", "cancelled", "missing"] as const)(
    "does not start workflow code after commands leave its target %s",
    async (status) => {
      const f = await commandFixture();
      const service = new DurableService({ ...f.config, tasks: [f.workflow] });
      await f.enqueue();
      const commands = service._executionManager.attemptRunner.commands!;
      jest.spyOn(commands, "drain").mockImplementation(async () => {
        if (status === "missing")
          jest.spyOn(f.store, "getExecution").mockResolvedValue(null);
        else await f.store.updateExecution("run", { status });
      });
      try {
        await expect(service.processExecution("run")).resolves.toBeUndefined();
      } finally {
        jest.restoreAllMocks();
        await service.stop();
      }
    },
  );

  it("rejects a storage key colliding with an existing compatibility alias", () => {
    const first = r
      .task("alias")
      .run(async () => 1)
      .build();
    const second = r
      .task("second")
      .run(async () => 2)
      .build();
    const registry = new TaskRegistry(undefined, (task) =>
      task === first ? "base" : "alias",
    );
    registry.register(first);
    expect(() => registry.register(second)).toThrow("already registered");
  });
});
