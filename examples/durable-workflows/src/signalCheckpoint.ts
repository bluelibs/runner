import { waitUntil } from "@bluelibs/runner/node";
import type { MemoryStore } from "@bluelibs/runner/node";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isWaitingForSignal(
  value: unknown,
  signalId: string,
): value is { state: "waiting"; signalId: string } {
  return (
    isRecord(value) &&
    value.state === "waiting" &&
    value.signalId === signalId
  );
}

export async function waitForSignalCheckpoint(params: {
  store: MemoryStore;
  executionId: string;
  signalId: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<void> {
  await waitUntil(
    async () => {
      const steps = await params.store.listStepResults(params.executionId);
      return steps.some((stepResult) =>
        isWaitingForSignal(stepResult.result, params.signalId),
      );
    },
    {
      timeoutMs: params.timeoutMs,
      intervalMs: params.intervalMs,
    },
  );
}
