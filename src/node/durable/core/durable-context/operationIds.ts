import type { SignalOptions } from "../interfaces/context";

/** Reserves the signal slot in invocation order, before any asynchronous work. */
export function reserveSignalWaitId(
  signalId: string,
  options: SignalOptions | undefined,
  indexes: Map<string, number>,
): string {
  if (options?.stepId) return `__signal:${options.stepId}`;
  const index = indexes.get(signalId) ?? 0;
  indexes.set(signalId, index + 1);
  return index === 0 ? `__signal:${signalId}` : `__signal:${signalId}:${index}`;
}
