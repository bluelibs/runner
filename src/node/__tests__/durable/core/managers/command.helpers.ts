import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import { r, tags } from "../../../..";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { CommandManager } from "../../../../durable/core/managers/CommandManager";
import { AttemptCancellationController } from "../../../../durable/core/managers/AttemptCancellationController";
import { createExecutionLockState } from "../../../../durable/core/managers/ExecutionManager.locking";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import type { DurableServiceConfig } from "../../../../durable/core/interfaces/service";
import {
  createTaskExecutor,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";
import { Logger } from "../../../../../models/Logger";

export async function commandFixture(
  handler: (d: IDurableContext) => Promise<unknown> = async () => 7,
  version?: number,
) {
  const store = new MemoryStore();
  const command = r
    .task("change")
    .run(async (_: number) => 7)
    .build();
  const workflow = r
    .task("workflow")
    .tags([tags.durableWorkflow.with({ commands: [command], version })])
    .run(async () => true)
    .build();
  const tasks = new TaskRegistry();
  tasks.register(workflow);
  const execution = pendingExecution({
    id: "run",
    workflowKey: workflow.id,
    status: "sleeping",
    workflowVersion: version,
  });
  await store.saveExecution(execution);
  let context!: IDurableContext;
  const config: DurableServiceConfig = {
    store,
    taskExecutor: createTaskExecutor({
      [command.id]: () => handler(context),
      [workflow.id]: async () => {
        throw new SuspensionSignal("yield");
      },
    }),
    contextProvider: (ctx, fn) => {
      context = ctx;
      return fn();
    },
  };
  const cancellation = new AttemptCancellationController({
    store,
    logger: new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    }),
    liveCancellationEventBus: null,
  });
  const lock = createExecutionLockState();
  const kickoff = jest.fn(async () =>
    manager.drain(execution, workflow, store, lock),
  );
  const manager = new CommandManager(config, tasks, kickoff, cancellation);
  const enqueue = async (id = "request") =>
    store.enqueueCommand({
      id,
      requestedExecutionId: "run",
      executionId: "run",
      taskKey: command.id,
      input: 1,
      status: "pending",
      createdAt: new Date(),
    });
  return {
    store,
    command,
    workflow,
    execution,
    config,
    tasks,
    cancellation,
    lock,
    kickoff,
    manager,
    enqueue,
  };
}
