import type { IDurableStore } from "../interfaces/store";
import { Logger } from "../../../../models/Logger";
import { durableExecutionInvariantError } from "../../../../errors";

export interface TimerClaimState {
  lossError: Error | null;
}

export function startTimerClaimHeartbeat(params: {
  store: IDurableStore;
  logger: Logger;
  workerId: string;
  timerId: string;
  claimTtlMs: number;
  claimState: TimerClaimState;
}): () => void {
  if (!params.store.renewTimerClaim) {
    return () => {};
  }

  const intervalMs = Math.max(1, Math.floor(params.claimTtlMs / 3));
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  const loseClaim = (message: string) => {
    if (params.claimState.lossError) return;
    params.claimState.lossError = durableExecutionInvariantError.new({
      message,
    });
    stopped = true;
  };

  const tick = () => {
    if (stopped) return;

    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      if (stopped) return;

      void params.store.renewTimerClaim!(
        params.timerId,
        params.workerId,
        params.claimTtlMs,
      )
        .then((renewed) => {
          if (!renewed) {
            loseClaim(
              `Timer claim lost for '${params.timerId}' while worker '${params.workerId}' was still handling it.`,
            );
          }
        })
        .catch(async (error) => {
          loseClaim(
            `Timer-claim heartbeat failed for '${params.timerId}' while worker '${params.workerId}' was still handling it.`,
          );
          try {
            await params.logger.error("Durable timer-claim heartbeat failed.", {
              error,
              data: { timerId: params.timerId, workerId: params.workerId },
            });
          } catch {
            // Logging must not crash timer-claim heartbeat loops.
          }
        })
        .finally(() => {
          tick();
        });
    }, intervalMs);

    heartbeatTimer.unref?.();
  };

  tick();

  return () => {
    stopped = true;
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
}
