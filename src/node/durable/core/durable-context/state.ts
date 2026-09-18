import type { IDurableStore } from "../interfaces/store";
import { isRecord } from "../utils";
import { durableLifecycleUnsupportedStoreCapabilityError } from "../../../../errors";

/**
 * Reads the workflow-owned typed state for one execution.
 * Resolves `undefined` until the workflow first sets state.
 */
export async function readDurableState<T>(
  store: IDurableStore,
  executionId: string,
): Promise<T | undefined> {
  if (!store.getWorkflowState) {
    return durableLifecycleUnsupportedStoreCapabilityError.throw({
      operation: "get-workflow-state",
    });
  }
  const record = await store.getWorkflowState<T>(executionId);
  return record?.state;
}

/**
 * Shallow-merges a patch into the current state. Records merge key-wise;
 * anything else (including empty current state) resolves to the patch, so a
 * merge can never silently drop values into an unspreadable shape.
 */
export function mergeDurableStatePatch<T>(
  current: unknown,
  patch: Partial<T>,
): T {
  if (isRecord(current) && isRecord(patch)) {
    return { ...current, ...patch } as T;
  }
  return patch as T;
}

/**
 * Persists the workflow-owned typed state record for one execution,
 * replacing any previous record (last-write-wins).
 */
export async function writeDurableState(
  store: IDurableStore,
  executionId: string,
  state: unknown,
): Promise<void> {
  if (!store.saveWorkflowState) {
    return durableLifecycleUnsupportedStoreCapabilityError.throw({
      operation: "save-workflow-state",
    });
  }
  await store.saveWorkflowState({
    executionId,
    state,
    updatedAt: new Date(),
  });
}
