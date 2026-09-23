import type { IDurableStore } from "../interfaces/store";
import type { IStepBuilder } from "../interfaces/context";
import { isPlainObject } from "../../../../tools/typeChecks";
import { DurableExecutionError } from "../utils";
import {
  durableLifecycleUnsupportedStoreCapabilityError,
  durableWorkflowStateInvalidError,
} from "../../../../errors";

/**
 * Reads the live workflow-owned state record for one execution.
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
 * Operator-side read of the live state record. A missing execution throws
 * instead of resolving `undefined`, which would be indistinguishable from an
 * execution that simply has not set state yet (e.g. a mistyped id).
 */
export async function readExistingExecutionState<T>(
  store: IDurableStore,
  executionId: string,
): Promise<T | undefined> {
  if (!(await store.getExecution(executionId))) {
    throw new DurableExecutionError(
      `Execution ${executionId} not found`,
      executionId,
      "unknown",
      0,
    );
  }
  return await readDurableState<T>(store, executionId);
}

/**
 * Shallow-merges a patch into the current state. Both sides must be plain
 * objects: spreading arrays or primitives would silently reshape the record
 * (e.g. `[1, 2]` into `{ "0": 1, "1": 2 }`), and patching empty state would
 * store a partial value typed as the full state.
 */
export function mergeDurableStatePatch(
  executionId: string,
  current: unknown,
  patch: unknown,
): Record<string, unknown> {
  if (!isPlainObject(patch)) {
    return durableWorkflowStateInvalidError.throw({
      executionId,
      reason: "setState patch must be a plain object",
    });
  }
  if (!isPlainObject(current)) {
    return durableWorkflowStateInvalidError.throw({
      executionId,
      reason:
        "setState needs existing object state; initialize it with replaceState first",
    });
  }
  return { ...current, ...patch };
}

/**
 * Persists the workflow-owned state record for one execution, replacing any
 * previous record.
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

export type DurableStateOperations = {
  get: <T>() => Promise<T | undefined>;
  patch: (patch: unknown) => Promise<void>;
  replace: (next: unknown) => Promise<void>;
};

/**
 * Builds replay-safe state operations for one attempt. Every read and write
 * is memoized as an internal step keyed by call order, so replay returns the
 * historical read and skips already-applied writes instead of re-running them
 * against the latest record. Reads and writes use separate counters so a read
 * can never resolve to a write's cached (void) result.
 */
export function createDurableStateOperations(params: {
  store: IDurableStore;
  executionId: string;
  assertCanWrite: () => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  internalStep: <T>(stepId: string) => IStepBuilder<T>;
}): DurableStateOperations {
  const { store, executionId } = params;
  let readIndex = 0;
  let writeIndex = 0;

  const nextStepId = (kind: "read" | "write"): string => {
    const index = kind === "read" ? readIndex++ : writeIndex++;
    const stepId = `__state:${kind}:${index}`;
    params.assertUniqueStepId(stepId);
    return stepId;
  };

  const write = async (resolveNext: () => Promise<unknown>): Promise<void> => {
    // Internal steps tolerate cancellation teardown; state writes must not.
    await params.assertCanWrite();
    await params.internalStep<void>(nextStepId("write")).up(async () => {
      await writeDurableState(store, executionId, await resolveNext());
    });
  };

  return {
    get: async <T>() =>
      await params
        .internalStep<T | undefined>(nextStepId("read"))
        .up(async () => await readDurableState<T>(store, executionId)),
    patch: async (patch) =>
      await write(async () =>
        mergeDurableStatePatch(
          executionId,
          await readDurableState<unknown>(store, executionId),
          patch,
        ),
      ),
    replace: async (next) => await write(async () => next),
  };
}
