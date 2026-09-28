export type WaitForExecutionOutcome<TResult> =
  | { kind: "completed"; data: TResult }
  | { kind: "timeout" };

/**
 * One chain-hop attempt of an execution wait: either the wait settled (or
 * suspended) on this tip, or the tip continued and the caller must hop to
 * the successor.
 */
export type ExecutionWaitHopOutcome<TResult> =
  | { kind: "done"; value: TResult | WaitForExecutionOutcome<TResult> }
  | { kind: "follow"; follow: string };

export type WriteExecutionWaitCurrent = (options: {
  timeoutMs?: number;
  timeoutAtMs?: number;
  timerId?: string;
  startedAt: Date;
}) => Promise<void>;
