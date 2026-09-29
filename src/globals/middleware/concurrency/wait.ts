import { Match } from "../../../tools/check";
import {
  middlewareConcurrencyQueueFullError,
  middlewareConcurrencyWaitTimeoutError,
} from "./errors";

/** Admission limits independent of the running-work limit. */
export interface ConcurrencyWaitOptions {
  /** Maximum waiting calls per resolved pool per runtime. Omitted means unlimited; zero disables waiting. */
  maxQueue?: number;
  /** Maximum acquisition wait in milliseconds. Omitted means unlimited; zero makes one immediate attempt. */
  waitTimeoutMs?: number;
}

/** Checks saturation synchronously before retaining another waiter. */
export function assertQueueAvailable(
  waiting: number,
  options: ConcurrencyWaitOptions,
): void {
  if (options.maxQueue !== undefined && waiting >= options.maxQueue) {
    middlewareConcurrencyQueueFullError.throw({ maxQueue: options.maxQueue });
  }
  if (options.waitTimeoutMs === 0) {
    middlewareConcurrencyWaitTimeoutError.throw({ waitTimeoutMs: 0 });
  }
}

/** Shared validation keeps direct handles and middleware admission options identical. */
export const concurrencyWaitPatterns = {
  maxQueue: Match.Optional(
    Match.Where(
      (value: unknown): value is number =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    ),
  ),
  waitTimeoutMs: Match.Optional(
    Match.Where(
      (value: unknown): value is number =>
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 2_147_483_647,
    ),
  ),
};
