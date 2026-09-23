import type { IDurableContext } from "../../../../node/durable/core/interfaces/context";
import type { IDurableStateContext } from "../../../../node/durable";
import type { IDurableResource } from "../../../../node/durable/core/interfaces/resource";
import type { IDurableService } from "../../../../node/durable/core/interfaces/service";
import type { IDurableStore } from "../../../../node/durable/core/interfaces/store";
import type {
  Execution,
  ExecutionStatus,
} from "../../../../node/durable/core/types";

// The new store methods are optional: a pre-change store surface (without
// them) still satisfies IDurableStore, so existing custom stores keep
// compiling. This assignment fails to compile if any of them becomes required.
type LegacyStoreSurface = Omit<
  IDurableStore,
  "createContinuedExecution" | "getWorkflowState" | "saveWorkflowState"
>;

declare const fullStore: IDurableStore;
const legacyStore: LegacyStoreSurface = fullStore;
const backToFull: IDurableStore = legacyStore;
void backToFull;

async function checkStateGenerics(ctx: IDurableContext): Promise<void> {
  await ctx.replaceState<{ count: number }>({ count: 1 });
  await ctx.setState<{ count: number }>({ count: 2 });
  const stateSurface: IDurableStateContext = ctx;
  void stateSurface;

  const state = await ctx.getState<{ count: number }>();
  const narrowed: { count: number } | undefined = state;
  void narrowed;

  const info = ctx.info();
  const executionId: string = info.executionId;
  const attempt: number = info.attempt;
  const stepCount: number = info.stepCount;
  void executionId;
  void attempt;
  void stepCount;

  await ctx.continueAsNew<{ orderId: string }>({ orderId: "o1" });
  await ctx.continueAsNew({ orderId: "o1" }, { state: { count: 3 } });
}

async function checkServiceGenerics(service: IDurableService): Promise<void> {
  await service.pauseExecution("e1");
  await service.resumeExecution("e1");

  const nextId: string = await service.restartExecution("e1", {
    idempotencyKey: "restart-key",
    input: { orderId: "o1" },
  });
  void nextId;

  const state = await service.getState<{ count: number }>("e1");
  const narrowed: { count: number } | undefined = state;
  void narrowed;
}

async function checkResourceGenerics(
  resource: IDurableResource,
): Promise<void> {
  const state = await resource.getState<{ count: number }>("e1");
  const narrowed: { count: number } | undefined = state;
  void narrowed;
}

async function checkStoreSurface(store: IDurableStore): Promise<void> {
  const prior = null as unknown as Execution;
  const successor = null as unknown as Execution;
  await store.createContinuedExecution?.({
    priorExecution: prior,
    successorExecution: successor,
  });

  const record = await store.getWorkflowState?.<{ count: number }>("e1");
  if (record) {
    const executionId: string = record.executionId;
    const count: number = record.state.count;
    const updatedAt: Date = record.updatedAt;
    void executionId;
    void count;
    void updatedAt;
  }
  await store.saveWorkflowState?.({
    executionId: "e1",
    state: { count: 1 },
    updatedAt: new Date(),
  });
}

function checkExecutionLineage(execution: Execution): void {
  const pausedAt: Date | undefined = execution.pausedAt;
  const pausedFrom: ExecutionStatus | undefined = execution.pausedFrom;
  void pausedFrom;
  const restartedFrom: string | undefined = execution.restartedFromExecutionId;
  const restartedAs: string | undefined = execution.restartedAsExecutionId;
  const continuedFrom: string | undefined = execution.continuedFromExecutionId;
  const continuedAs: string | undefined = execution.continuedAsExecutionId;
  void pausedAt;
  void restartedFrom;
  void restartedAs;
  void continuedFrom;
  void continuedAs;
}

void checkStateGenerics;
void checkServiceGenerics;
void checkResourceGenerics;
void checkStoreSurface;
void checkExecutionLineage;
