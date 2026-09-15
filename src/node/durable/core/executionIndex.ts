import type {
  DurableExecutionState,
  Execution,
  ExecutionStatus,
} from "./types";
import type { ListExecutionsOptions } from "./interfaces/store";
import { decodeExecutionCursor } from "./executionCursor";
import { durableExecutionInvariantError } from "../../../errors";

/** Bounds index work even for callers using the store directly. */
export function executionQueryLimit(options: ListExecutionsOptions): number {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    durableExecutionInvariantError.throw({
      message: "Indexed execution limit must be an integer between 1 and 1000.",
    });
  }
  if (options.offset !== undefined || options.parentExecutionId !== undefined) {
    durableExecutionInvariantError.throw({
      message:
        "Indexed execution states support cursor, workflow and status filters, not offset or parent filters.",
    });
  }
  return limit;
}

/** Payload-free projection shared by stores and the operator. */
export function toDurableExecutionState(
  execution: Execution,
): DurableExecutionState {
  return {
    id: execution.id,
    workflowKey: execution.workflowKey,
    parentExecutionId: execution.parentExecutionId,
    status: execution.status,
    attempt: execution.attempt,
    maxAttempts: execution.maxAttempts,
    current: execution.current,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    completedAt: execution.completedAt,
  };
}

/** Lexical storage key preserving newest-first time and exact UTF-16 id order. */
export function executionIndexMember(execution: {
  createdAt: Date | string;
  id: string;
}): string {
  const time = (
    8640000000000000n - BigInt(new Date(execution.createdAt).getTime())
  )
    .toString()
    .padStart(17, "0");
  let id = "";
  for (let index = 0; index < execution.id.length; index++) {
    id += execution.id.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return `${time}:${id}`;
}

/** Exact, collision-free partition identity; never normalize workflow ids. */
export function executionIndexPartition(
  workflowKey?: string,
  status?: ExecutionStatus,
): string {
  return JSON.stringify([workflowKey ?? null, status ?? null]);
}

/** Four write-through partitions serve unfiltered, workflow, status and combined reads. */
export function executionIndexPartitions(
  execution: DurableExecutionState,
): string[] {
  return [
    executionIndexPartition(),
    executionIndexPartition(execution.workflowKey),
    executionIndexPartition(undefined, execution.status),
    executionIndexPartition(execution.workflowKey, execution.status),
  ];
}

/** Partitions to merge for one query, with duplicate states removed. */
export function executionQueryPartitions(
  options: ListExecutionsOptions,
): string[] {
  return options.status?.length
    ? [...new Set(options.status)].map((status) =>
        executionIndexPartition(options.workflowKey, status),
      )
    : [executionIndexPartition(options.workflowKey)];
}

/** Exclusive lexical lower bound for a cursor, or the beginning of the index. */
export function executionQueryAfter(options: ListExecutionsOptions): string {
  return options.cursor === undefined
    ? ""
    : executionIndexMember(decodeExecutionCursor(options.cursor));
}
