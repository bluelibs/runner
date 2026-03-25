import { ExecutionStatus, type Execution } from "../core/types";
import type { ExpectedExecutionStatuses } from "../core/interfaces/store";
import { durableStoreShapeError } from "../../../errors";
import type { RedisStoreRuntime } from "./RedisStore.runtime";
import { saveStepResult } from "./RedisStore.executionViews";

function isActiveExecutionStatus(status: ExecutionStatus): boolean {
  return (
    status !== ExecutionStatus.Completed &&
    status !== ExecutionStatus.Failed &&
    status !== ExecutionStatus.CompensationFailed &&
    status !== ExecutionStatus.Cancelled
  );
}

function saveExecutionIndexesScript(): string {
  return `
    redis.call("sadd", KEYS[2], ARGV[2])

    if ARGV[3] == "1" then
      redis.call("sadd", KEYS[3], ARGV[2])
    else
      redis.call("srem", KEYS[3], ARGV[2])
    end

    if ARGV[4] == "1" then
      redis.call("sadd", KEYS[4], ARGV[2])
    else
      redis.call("srem", KEYS[4], ARGV[2])
    end
  `;
}

function saveExecutionScript(): string {
  return `
    redis.call("set", KEYS[1], ARGV[1])
    ${saveExecutionIndexesScript()}
    return "OK"
  `;
}

function statusFlags(status: ExecutionStatus): {
  isActive: "1" | "0";
  isStuck: "1" | "0";
} {
  return {
    isActive: isActiveExecutionStatus(status) ? "1" : "0",
    isStuck: status === ExecutionStatus.CompensationFailed ? "1" : "0",
  };
}

async function loadExecutionsFromSet(
  runtime: RedisStoreRuntime,
  setKey: string,
): Promise<Execution[]> {
  const executionIds = await runtime.scanSetMembers(setKey);
  if (executionIds.length === 0) return [];

  const pipeline = runtime.redis.pipeline();
  executionIds.forEach((id) => pipeline.get(runtime.executionKey(id)));
  const results = await pipeline.exec();
  if (!results) return [];

  const staleIds: string[] = [];
  const executions: Execution[] = [];

  for (let index = 0; index < executionIds.length; index += 1) {
    const raw = results[index]?.[1];
    if (typeof raw !== "string") {
      staleIds.push(executionIds[index]);
      continue;
    }

    executions.push(runtime.serializer.parse(raw) as Execution);
  }

  if (staleIds.length > 0) {
    try {
      await runtime.redis.srem(setKey, ...staleIds);
    } catch {
      // Best-effort cleanup; ignore.
    }
  }

  return executions;
}

export async function createExecutionWithIdempotencyKey(
  runtime: RedisStoreRuntime,
  params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  },
): Promise<
  | { created: true; executionId: string }
  | { created: false; executionId: string }
> {
  const { isActive, isStuck } = statusFlags(params.execution.status);
  const outcome = await runtime.redis.eval(
    `
      local existingId = redis.call("get", KEYS[1])
      if existingId then
        return existingId
      end

      redis.call("set", KEYS[1], ARGV[2])
      redis.call("set", KEYS[2], ARGV[1])
      ${saveExecutionIndexesScript()}
      return "__created__"
    `,
    5,
    runtime.idempotencyKey(params.workflowKey, params.idempotencyKey),
    runtime.executionKey(params.execution.id),
    runtime.allExecutionsKey(),
    runtime.activeExecutionsKey(),
    runtime.stuckExecutionsKey(),
    runtime.serializer.stringify(params.execution),
    params.execution.id,
    isActive,
    isStuck,
  );

  if (outcome === "__created__") {
    return { created: true, executionId: params.execution.id };
  }

  const executionId = runtime.parseRedisString(outcome);
  if (executionId !== null) {
    return { created: false, executionId };
  }

  throw durableStoreShapeError.new({
    message: "Unexpected Redis idempotent execution create response",
  });
}

export async function saveExecution(
  runtime: RedisStoreRuntime,
  execution: Execution,
): Promise<void> {
  const { isActive, isStuck } = statusFlags(execution.status);
  await runtime.redis.eval(
    saveExecutionScript(),
    4,
    runtime.executionKey(execution.id),
    runtime.allExecutionsKey(),
    runtime.activeExecutionsKey(),
    runtime.stuckExecutionsKey(),
    runtime.serializer.stringify(execution),
    execution.id,
    isActive,
    isStuck,
  );
}

export async function saveExecutionIfStatus(
  runtime: RedisStoreRuntime,
  execution: Execution,
  expectedStatuses: ExpectedExecutionStatuses,
): Promise<boolean> {
  const { isActive, isStuck } = statusFlags(execution.status);
  const outcome = await runtime.redis.eval(
    `
      local current = redis.call("get", KEYS[1])
      if not current then
        return 0
      end

      local okCurrent, currentExecution = pcall(cjson.decode, current)
      if not okCurrent then
        return "__error__:Corrupted durable execution payload"
      end

      local okExpected, expectedStatuses = pcall(cjson.decode, ARGV[5])
      if not okExpected then
        return "__error__:Invalid expected execution statuses payload"
      end

      local matches = false
      for _, expectedStatus in ipairs(expectedStatuses) do
        if currentExecution.status == expectedStatus then
          matches = true
          break
        end
      end

      if not matches then
        return 0
      end

      redis.call("set", KEYS[1], ARGV[1])
      ${saveExecutionIndexesScript()}
      return 1
    `,
    4,
    runtime.executionKey(execution.id),
    runtime.allExecutionsKey(),
    runtime.activeExecutionsKey(),
    runtime.stuckExecutionsKey(),
    runtime.serializer.stringify(execution),
    execution.id,
    isActive,
    isStuck,
    runtime.serializer.stringify(expectedStatuses),
  );
  runtime.assertEvalResultNotError(outcome);
  return outcome === 1;
}

export async function getExecution(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<Execution | null> {
  const data = runtime.parseRedisString(
    await runtime.redis.get(runtime.executionKey(id)),
  );
  return data ? (runtime.serializer.parse(data) as Execution) : null;
}

export async function updateExecution(
  runtime: RedisStoreRuntime,
  id: string,
  updates: Partial<Execution>,
): Promise<void> {
  const current = await getExecution(runtime, id);
  if (!current) return;
  await saveExecution(runtime, {
    ...current,
    ...updates,
    updatedAt: new Date(),
  });
}

export async function listIncompleteExecutions(
  runtime: RedisStoreRuntime,
): Promise<Execution[]> {
  const executions = await loadExecutionsFromSet(
    runtime,
    runtime.activeExecutionsKey(),
  );
  const inactiveIds = executions
    .filter((execution) => !isActiveExecutionStatus(execution.status))
    .map((execution) => execution.id);

  if (inactiveIds.length > 0) {
    try {
      await runtime.redis.srem(runtime.activeExecutionsKey(), ...inactiveIds);
    } catch {
      // Best-effort cleanup; ignore.
    }
  }

  return executions.filter((execution) =>
    isActiveExecutionStatus(execution.status),
  );
}

export async function listStuckExecutions(
  runtime: RedisStoreRuntime,
): Promise<Execution[]> {
  const executions = await loadExecutionsFromSet(
    runtime,
    runtime.stuckExecutionsKey(),
  );
  return executions.filter(
    (execution) => execution.status === ExecutionStatus.CompensationFailed,
  );
}

export async function retryRollback(
  runtime: RedisStoreRuntime,
  executionId: string,
): Promise<void> {
  const execution = await getExecution(runtime, executionId);
  if (!execution) return;

  await saveExecution(runtime, {
    ...execution,
    status: ExecutionStatus.Pending,
    error: undefined,
    updatedAt: new Date(),
  });
}

export async function skipStep(
  runtime: RedisStoreRuntime,
  executionId: string,
  stepId: string,
): Promise<void> {
  await saveStepResult(runtime, {
    executionId,
    stepId,
    result: { skipped: true, manual: true },
    completedAt: new Date(),
  });
}

export async function forceFail(
  runtime: RedisStoreRuntime,
  executionId: string,
  error: { message: string; stack?: string },
): Promise<void> {
  await updateExecution(runtime, executionId, {
    status: ExecutionStatus.Failed,
    error,
  });
}

export async function editStepResult(
  runtime: RedisStoreRuntime,
  executionId: string,
  stepId: string,
  newResult: unknown,
): Promise<void> {
  await saveStepResult(runtime, {
    executionId,
    stepId,
    result: newResult,
    completedAt: new Date(),
  });
}
