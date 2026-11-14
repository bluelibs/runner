import { durableExecutionInvariantError } from "../../../../errors";
import { check, Match } from "../../../../tools/check";
import type { IDurableStore } from "../interfaces/store";
import type { DurableStepContext } from "../interfaces/context.step";
import { createTimeoutExceededError } from "../utils";

/** Owns callback progress independently of execution-lease heartbeats. */
export async function createStepProgress(params: {
  store: IDurableStore;
  executionId: string;
  stepId: string;
  attempt: number;
  identityExecutionId?: string;
  heartbeatTimeoutMs?: number;
  assertCanContinue: () => Promise<void>;
}) {
  if (params.heartbeatTimeoutMs !== undefined)
    check(params.heartbeatTimeoutMs, Match.Range({ min: 1, integer: true }));
  const progressId = `__step-progress:${JSON.stringify(params.stepId)}`;
  const saved = await params.store.getStepResult(
    params.executionId,
    progressId,
  );
  let progress: unknown = saved?.result;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  const controller = new AbortController();
  const assertOpen = () => {
    if (closed || controller.signal.aborted)
      durableExecutionInvariantError.throw({
        message: `Step '${params.stepId}' no longer owns progress writes.`,
      });
  };
  const arm = () => {
    clearTimeout(timer);
    if (params.heartbeatTimeoutMs !== undefined) {
      timer = setTimeout(
        () =>
          controller.abort(
            createTimeoutExceededError(
              `Step ${params.stepId} heartbeat timed out`,
            ),
          ),
        params.heartbeatTimeoutMs,
      );
      timer.unref();
    }
  };
  return {
    signal: controller.signal,
    async run<T>(
      signal: AbortSignal,
      fn: (context: DurableStepContext) => Promise<T>,
    ): Promise<T> {
      assertOpen();
      arm();
      const context: DurableStepContext = {
        signal,
        idempotencyKey: `durable-step:${JSON.stringify([params.identityExecutionId === undefined ? "execution" : "command", params.identityExecutionId ?? params.executionId, params.stepId])}`,
        attempt: params.attempt,
        getProgress: <P>() => structuredClone(progress) as P | undefined,
        heartbeat: <P>(next: P) => {
          const snapshot = structuredClone(next);
          const write = writes.then(async () => {
            assertOpen();
            signal.throwIfAborted();
            await params.assertCanContinue();
            assertOpen();
            signal.throwIfAborted();
            await params.store.saveStepResult({
              executionId: params.executionId,
              stepId: progressId,
              result: snapshot,
              completedAt: new Date(),
            });
            progress = snapshot;
            if (!closed) arm();
          });
          // A handled storage error must not poison a later heartbeat retry.
          writes = write.catch(() => undefined);
          return write;
        },
      };
      return await fn(context);
    },
    close() {
      closed = true;
      clearTimeout(timer);
    },
  };
}
