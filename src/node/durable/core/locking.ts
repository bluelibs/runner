import type { IDurableStore } from "./interfaces/store";

export type LockingStore = Pick<IDurableStore, "acquireLock" | "releaseLock">;

export interface AcquiredStoreLock {
  lockId: string | "no-lock";
  release: () => Promise<void>;
}

export async function acquireStoreLock(params: {
  store: LockingStore;
  resource: string;
  ttlMs: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<AcquiredStoreLock | null> {
  if (!params.store.acquireLock || !params.store.releaseLock) {
    return {
      lockId: "no-lock",
      release: async () => {},
    };
  }

  const maxAttempts = params.maxAttempts ?? 1;
  const retryDelayMs = params.retryDelayMs ?? 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const lockId = await params.store.acquireLock(
      params.resource,
      params.ttlMs,
    );
    if (lockId !== null) {
      const acquiredLockId = lockId;
      return {
        lockId: acquiredLockId,
        release: async () => {
          try {
            await params.store.releaseLock!(params.resource, acquiredLockId);
          } catch {
            // best-effort cleanup; ignore
          }
        },
      };
    }

    if (attempt + 1 < maxAttempts && retryDelayMs > 0) {
      await params.sleep(retryDelayMs);
    }
  }

  return null;
}

export async function withStoreLock<T>(params: {
  store: LockingStore;
  resource: string;
  ttlMs: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep: (ms: number) => Promise<void>;
  onLockUnavailable: () => never;
  fn: () => Promise<T>;
}): Promise<T> {
  const acquired = await acquireStoreLock({
    store: params.store,
    resource: params.resource,
    ttlMs: params.ttlMs,
    maxAttempts: params.maxAttempts,
    retryDelayMs: params.retryDelayMs,
    sleep: params.sleep,
  });

  if (acquired === null) {
    return params.onLockUnavailable();
  }

  try {
    return await params.fn();
  } finally {
    await acquired.release();
  }
}
