import type { IDurableStore } from "./interfaces/store";
import { durableExecutionInvariantError } from "../../../errors";
import {
  createExecutionLockState,
  startLockHeartbeat,
} from "./managers/ExecutionManager.locking";

/** Checkpoint tools share the worker lease so a captured prefix cannot race live callbacks. */
export async function withCheckpointLease<T>(
  store: IDurableStore,
  sourceId: string,
  action: (owned: IDurableStore) => Promise<T>,
): Promise<T> {
  if (
    !store.withExecutionOwnership ||
    !store.acquireLock ||
    !store.releaseLock ||
    !store.renewLock
  )
    return durableExecutionInvariantError.throw({
      message: "Checkpoint tools require renewable atomic execution ownership.",
    });
  const resource = `execution:${sourceId}`;
  const lockId = await store.acquireLock(resource, 30000);
  if (lockId === null)
    return durableExecutionInvariantError.throw({
      message:
        "Source execution is still owned by a worker; wait for it to stop before using checkpoint tools.",
    });
  const lock = createExecutionLockState();
  const stop = startLockHeartbeat({
    store,
    lockResource: resource,
    lockId,
    lockTtlMs: 30000,
    lockState: lock,
  });
  try {
    const owned = store.withExecutionOwnership({
      executionId: sourceId,
      lockId,
      onLost: () =>
        durableExecutionInvariantError.throw({
          message: "Checkpoint operation lost source execution ownership.",
        }),
    });
    return await action(owned);
  } finally {
    stop();
    await store.releaseLock(resource, lockId);
  }
}
