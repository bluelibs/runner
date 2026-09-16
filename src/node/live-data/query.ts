import { validationError } from "../../errors";
import type { AnyTask } from "../../defs";
import type { LiveQuery, LiveQueryOptions } from "./types";

/** Binds an ordinary Runner task to exact invalidation topics. */
export function query<TTask extends AnyTask>(
  options: LiveQueryOptions<TTask>,
): LiveQuery<TTask> {
  const batchWindowMs = options.batchWindowMs ?? 0;
  const share = options.share ?? false;

  assertNonNegativeInteger("batchWindowMs", batchWindowMs);
  if (options.revalidateEveryMs !== undefined) {
    assertPositiveInteger("revalidateEveryMs", options.revalidateEveryMs);
  }
  if (typeof options.topics !== "function") {
    invalidQuery("topics must be a function.");
  }

  return Object.freeze({
    task: options.task,
    topics: options.topics,
    share,
    batchWindowMs,
    revalidateEveryMs: options.revalidateEveryMs,
    asyncContexts: Object.freeze([...(options.asyncContexts ?? [])]),
  });
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    invalidQuery(`${name} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    invalidQuery(`${name} must be a positive integer.`);
  }
}

function invalidQuery(message: string): never {
  return validationError.throw({
    subject: "Live query",
    id: "liveData",
    originalError: message,
  });
}
