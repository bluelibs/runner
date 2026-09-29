import { DurableContext } from "../../../../durable/core/DurableContext";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { ExecutionStatus } from "../../../../durable/core/types";

export function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

export async function stepFixture(
  options: {
    store?: MemoryStore;
    executionId?: string;
    workflowKey?: string;
    attempt?: number;
    contextOptions?: ConstructorParameters<typeof DurableContext>[4];
  } = {},
) {
  const store = options.store ?? new MemoryStore();
  const executionId = options.executionId ?? "execution";
  await store.saveExecution({
    id: executionId,
    workflowKey: options.workflowKey ?? "orders.v1",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: options.attempt ?? 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const context = () =>
    new DurableContext(
      store,
      new MemoryEventBus(),
      executionId,
      options.attempt ?? 1,
      options.contextOptions,
    );
  return { store, ctx: context(), replay: context, executionId };
}
