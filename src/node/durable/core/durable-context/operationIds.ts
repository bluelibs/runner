import type { SignalOptions } from "../interfaces/context";

/** Peeks at the next signal slot; the wait implementation consumes the counter. */
export function createSignalWaitIdentity(
  signalId: string,
  options: SignalOptions | undefined,
  indexes: Map<string, number>,
): string {
  const index = indexes.get(signalId) ?? 0;
  return options?.stepId
    ? `__signal:${options.stepId}`
    : index === 0
      ? `__signal:${signalId}`
      : `__signal:${signalId}:${index}`;
}
