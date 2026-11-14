import type {
  DurableStepId,
  IStepBuilder,
  StepOptions,
} from "../../../../node";
import { r } from "../../../../node";
import type {
  IDurableContext,
  IDurableWorkflowContext,
  DurableStepRunContext,
  DurableResource,
  IDurableService,
  IDurableStore,
  TimerType,
} from "../../../../node";

void (async (d: IDurableWorkflowContext, durable: DurableResource) => {
  const task = r
    .task("charge")
    .run(async (input: { amount: number }) => input.amount * 2)
    .build();
  const noInput = r
    .task("no-input")
    .run(async () => "done")
    .build();
  const amount: number = await d.step(
    "charge",
    task,
    { amount: 5 },
    { retries: 3 },
  );
  const result: string = await d.step("no-input", noInput);
  const commandResult: number = await durable.command("execution", task, {
    amount: 5,
  });
  void [amount, result, commandResult];
  await d.step(
    "legacy",
    async (context: DurableStepRunContext) => !context.signal.aborted,
  );
  await d.step("progress", async (step) => {
    await step.heartbeat({ cursor: 1 });
    return step.getProgress<{ cursor: number }>();
  });
  // @ts-expect-error Task input is required and inferred.
  d.step("invalid", task);
  // @ts-expect-error Invalid task input is rejected at compile time.
  d.step("invalid-input", task, { amount: "five" });
  // @ts-expect-error Command input is inferred from the ordinary Runner task.
  durable.command("execution", task, { amount: "five" });
});

type LegacyStore = Omit<
  IDurableStore,
  | "enqueueCommand"
  | "rescheduleCommandTimer"
  | "getCommand"
  | "getNextCommand"
  | "saveCommand"
  | "completeCommand"
  | "recordExecutionHistory"
  | "listExecutionHistory"
  | "createCheckpointExecution"
  | "getWorkflowTime"
>;
type LegacyService = Omit<IDurableService, "command" | "kickoffExecution">;
declare const oldStore: LegacyStore;
declare const oldService: LegacyService;
const store: IDurableStore = oldStore;
const service: IDurableService = oldService;
void [store, service];

// Shared command wakeups retain the existing timer variants for exhaustive consumers.
const legacyTimerTypes: Record<TimerType, true> = {
  sleep: true,
  timeout: true,
  scheduled: true,
  cron: true,
  retry: true,
  signal_timeout: true,
};
void legacyTimerTypes;

// Existing callback-oriented context implementations remain structurally compatible.

type LegacyContext = Omit<IDurableContext, "step"> & {
  step<T>(id: string | DurableStepId<T>): IStepBuilder<T>;
  step<T>(
    id: string | DurableStepId<T>,
    fn: (context: DurableStepRunContext) => Promise<T>,
  ): Promise<T>;
  step<T>(
    id: string | DurableStepId<T>,
    options: StepOptions,
    fn: (context: DurableStepRunContext) => Promise<T>,
  ): Promise<T>;
};
declare const oldContext: LegacyContext;
const context: IDurableContext = oldContext;
void context;
