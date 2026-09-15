import { durableExecutionInvariantError } from "../../../errors";
import type { Execution } from "./types";

/**
 * Opaque keyset cursor for stable execution listing.
 *
 * Pages are ordered by `createdAt` descending with `id` ascending as the
 * tiebreak. A cursor captures the last row of a page; the next page holds
 * rows strictly after that key. Unlike offset pagination, later pages stay
 * stable while new executions are created concurrently.
 */
export interface ExecutionCursor {
  createdAt: string;
  id: string;
}

/** Encodes a listing position into an opaque cursor token. */
export function encodeExecutionCursor(cursor: ExecutionCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Decodes a cursor token. Fails fast on corrupt tokens: a cursor that cannot
 * be decoded must never silently restart listing from the beginning.
 */
export function decodeExecutionCursor(cursor: string): ExecutionCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as ExecutionCursor).createdAt === "string" &&
      typeof (parsed as ExecutionCursor).id === "string" &&
      !Number.isNaN(new Date((parsed as ExecutionCursor).createdAt).getTime())
    ) {
      return parsed as ExecutionCursor;
    }
  } catch {
    // Fall through to the contract error below.
  }
  return durableExecutionInvariantError.throw({
    message: `Invalid execution listing cursor.`,
  });
}

/** Stable listing order: newest first, `id` ascending as the tiebreak. */
export function compareExecutionsForListing(
  left: Execution,
  right: Execution,
): number {
  const createdAtDelta =
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Whether `execution` sorts strictly after `cursor` in listing order. */
export function isExecutionAfterCursor(
  execution: Execution,
  cursor: ExecutionCursor,
): boolean {
  const executionTime = new Date(execution.createdAt).getTime();
  const cursorTime = new Date(cursor.createdAt).getTime();
  if (executionTime !== cursorTime) {
    return executionTime < cursorTime;
  }
  return execution.id > cursor.id;
}
