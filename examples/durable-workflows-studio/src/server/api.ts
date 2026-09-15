/**
 * Studio HTTP API: pure request handlers over the durable backend.
 *
 * Handlers take parsed input and return `{ status, body }` so they stay
 * decoupled from the `node:http` transport (and easy to drive in tests).
 */
import { errors } from "@bluelibs/runner";
import {
  createDurableAuditEntryId,
  CronParser,
  DurableAuditEntryKind,
  type DurableAuditEntry,
  type DurableSignalState,
  type Execution,
  type Schedule,
  type StepResult,
} from "@bluelibs/runner/node";
import type {
  StudioAuditEntry,
  StudioExecutionDetail,
  StudioExecutionFilters,
  StudioExecutionStatus,
  StudioExecutionSummary,
  StudioRecoverReport,
  StudioSchedule,
  StudioSignalJournal,
  StudioStepResult,
  StudioWorkflow,
} from "../shared/types.js";
import { getWorkflow, WORKFLOWS } from "../workflows/catalog.js";
import {
  incidentInputSchema,
  incidentResponse,
  type IncidentInput,
} from "../workflows/incidentResponse.js";
import {
  onboardingInputSchema,
  type OnboardingInput,
  userOnboarding,
} from "../workflows/userOnboarding.js";
import {
  orderInputSchema,
  type OrderInput,
  processOrder,
} from "../workflows/orderProcessing.js";
import {
  portfolioReconciliation,
  portfolioReconciliationInputSchema,
  type PortfolioReconciliationInput,
} from "../workflows/portfolioReconciliation.js";
import {
  regionalRollup,
  regionalRollupInputSchema,
  type RegionalRollupInput,
} from "../workflows/regionalRollup.js";
import {
  ApprovalDecision,
  approvalDecisionPayloadSchema,
  EmailVerified,
  emailVerifiedPayloadSchema,
  IncidentAcknowledged,
  incidentAcknowledgedPayloadSchema,
  PaymentConfirmed,
  paymentConfirmedPayloadSchema,
} from "../workflows/signals.js";
import {
  SIGNALS_BY_ID,
  TASKS_BY_KEY,
  type StudioHandles,
} from "./studioApp.js";
import {
  describePosition,
  isTerminalStatus,
  projectTimeline,
} from "./timeline.js";

export interface ApiResponse {
  status: number;
  body: unknown;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const created = (body: unknown): ApiResponse => ({ status: 201, body });
const accepted = (body: unknown): ApiResponse => ({ status: 202, body });
const badRequest = (message: string): ApiResponse => ({
  status: 400,
  body: { error: message },
});
const notFound = (message: string): ApiResponse => ({
  status: 404,
  body: { error: message },
});
const conflict = (message: string): ApiResponse => ({
  status: 409,
  body: { error: message },
});

type ApiValidation<T> =
  | { ok: true; value: T }
  | { ok: false; response: ApiResponse };

function validateApiPayload<T>(
  subject: string,
  schema: { parse(input: unknown): T },
  input: unknown,
): ApiValidation<T> {
  try {
    return { ok: true, value: schema.parse(input) };
  } catch (error) {
    if (!errors.matchError.is(error)) throw error;
    return {
      ok: false,
      response: badRequest(`${subject} is invalid. ${error.message}`),
    };
  }
}

function validateWorkflowInput(
  workflow: string,
  input: unknown,
): ApiResponse | undefined {
  const subject = `Workflow input for '${workflow}'`;
  let validation: ApiValidation<unknown>;
  switch (workflow) {
    case "processOrder":
      validation = validateApiPayload(subject, orderInputSchema, input);
      break;
    case "userOnboarding":
      validation = validateApiPayload(subject, onboardingInputSchema, input);
      break;
    case "incidentResponse":
      validation = validateApiPayload(subject, incidentInputSchema, input);
      break;
    case "portfolioReconciliation":
      validation = validateApiPayload(
        subject,
        portfolioReconciliationInputSchema,
        input,
      );
      break;
    case "regionalRollup":
      validation = validateApiPayload(
        subject,
        regionalRollupInputSchema,
        input,
      );
      break;
    default:
      throw new Error(`Unexpected workflow '${workflow}'.`);
  }
  return validation.ok ? undefined : validation.response;
}

const DEFAULT_EXECUTION_PAGE_SIZE = 100;
const MAX_EXECUTION_PAGE_SIZE = 100;

/** Deep-converts Dates to ISO strings so DTOs are JSON-safe. */
export function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return value;
}

function toStepDto(step: StepResult): StudioStepResult {
  return {
    stepId: step.stepId,
    result: jsonSafe(step.result),
    completedAt: step.completedAt.toISOString(),
  };
}

function toAuditDto(entry: DurableAuditEntry): StudioAuditEntry {
  const { id, at, kind, attempt, executionId: _omit, ...detail } = entry;
  return {
    id,
    at: at.toISOString(),
    kind,
    attempt,
    detail: jsonSafe(detail) as Record<string, unknown>,
  };
}

function toSignalDto(state: DurableSignalState): StudioSignalJournal {
  const queuedIds = new Set(state.queued.map((record) => record.id));
  return {
    signalId: state.signalId,
    history: state.history.map((record) => ({
      id: record.id,
      payload: jsonSafe(record.payload),
      receivedAt: record.receivedAt.toISOString(),
      state: queuedIds.has(record.id) ? "queued" : "consumed",
    })),
  };
}

function workflowTitle(workflowKey: string): string {
  return getWorkflow(workflowKey)?.title ?? workflowKey;
}

async function toSummary(
  handles: StudioHandles,
  execution: Execution,
): Promise<StudioExecutionSummary> {
  // Live executions deserve a rich position line; terminal ones need no reads.
  const steps = isTerminalStatus(execution.status)
    ? []
    : await handles.store.listStepResults(execution.id);
  return {
    id: execution.id,
    workflowKey: execution.workflowKey,
    workflowTitle: workflowTitle(execution.workflowKey),
    status: execution.status,
    attempt: execution.attempt,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
    position: describePosition(
      execution,
      steps,
      getWorkflow(execution.workflowKey),
    ),
    ...(execution.parentExecutionId
      ? { parentExecutionId: execution.parentExecutionId }
      : {}),
  };
}

const VALID_STATUSES: StudioExecutionStatus[] = [
  "pending",
  "running",
  "cancelling",
  "retrying",
  "sleeping",
  "completed",
  "compensation_failed",
  "failed",
  "cancelled",
];

export function listWorkflows(): ApiResponse {
  return ok({ workflows: WORKFLOWS });
}

export function getWorkflowByKey(key: string): ApiResponse {
  const workflow = getWorkflow(key);
  if (!workflow) return notFound(`Unknown workflow '${key}'.`);
  return ok({ workflow });
}

export async function startExecution(
  handles: StudioHandles,
  input: unknown,
): Promise<ApiResponse> {
  if (typeof input !== "object" || input === null) {
    return badRequest("Body must be an object with 'workflow' and 'input'.");
  }
  const { workflow, input: workflowInput } = input as Record<string, unknown>;
  if (typeof workflow !== "string" || !(workflow in TASKS_BY_KEY)) {
    return badRequest(
      `Unknown workflow '${String(workflow)}'. Known: ${Object.keys(TASKS_BY_KEY).join(", ")}.`,
    );
  }
  let executionId: string;
  switch (workflow) {
    case "processOrder": {
      const validated = validateApiPayload(
        "Workflow input for 'processOrder'",
        orderInputSchema,
        workflowInput,
      );
      if (!validated.ok) return validated.response;
      executionId = await handles.durable.start(processOrder, validated.value);
      break;
    }
    case "userOnboarding": {
      const validated = validateApiPayload(
        "Workflow input for 'userOnboarding'",
        onboardingInputSchema,
        workflowInput,
      );
      if (!validated.ok) return validated.response;
      executionId = await handles.durable.start(
        userOnboarding,
        validated.value,
      );
      break;
    }
    case "incidentResponse": {
      const validated = validateApiPayload(
        "Workflow input for 'incidentResponse'",
        incidentInputSchema,
        workflowInput,
      );
      if (!validated.ok) return validated.response;
      executionId = await handles.durable.start(
        incidentResponse,
        validated.value,
      );
      break;
    }
    case "portfolioReconciliation": {
      const validated = validateApiPayload(
        "Workflow input for 'portfolioReconciliation'",
        portfolioReconciliationInputSchema,
        workflowInput,
      );
      if (!validated.ok) return validated.response;
      executionId = await handles.durable.start(
        portfolioReconciliation,
        validated.value,
      );
      break;
    }
    case "regionalRollup": {
      const validated = validateApiPayload(
        "Workflow input for 'regionalRollup'",
        regionalRollupInputSchema,
        workflowInput,
      );
      if (!validated.ok) return validated.response;
      executionId = await handles.durable.start(
        regionalRollup,
        validated.value,
      );
      break;
    }
    default:
      return badRequest(
        `Unknown workflow '${workflow}'. Known: ${Object.keys(TASKS_BY_KEY).join(", ")}.`,
      );
  }
  return created({ executionId });
}

export async function listExecutions(
  handles: StudioHandles,
  filters: StudioExecutionFilters,
): Promise<ApiResponse> {
  if (
    filters.status !== undefined &&
    !VALID_STATUSES.includes(filters.status)
  ) {
    return badRequest(
      `Unknown status '${filters.status}'. Known: ${VALID_STATUSES.join(", ")}.`,
    );
  }
  if (
    filters.workflowKey !== undefined &&
    getWorkflow(filters.workflowKey) === undefined
  ) {
    return badRequest(`Unknown workflow '${filters.workflowKey}'.`);
  }
  const limit = filters.limit ?? DEFAULT_EXECUTION_PAGE_SIZE;
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXECUTION_PAGE_SIZE) {
    return badRequest(
      `'limit' must be an integer between 1 and ${MAX_EXECUTION_PAGE_SIZE}.`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return badRequest("'offset' must be a non-negative integer.");
  }
  const executions = await handles.store.listExecutions({
    status: filters.status ? [filters.status] : undefined,
    workflowKey: filters.workflowKey,
    limit: limit + 1,
    offset,
  });
  const hasMore = executions.length > limit;
  const page = executions.slice(0, limit);
  const summaries: StudioExecutionSummary[] = [];
  for (const execution of page) {
    summaries.push(await toSummary(handles, execution));
  }
  return ok({
    executions: summaries,
    hasMore,
    nextOffset: hasMore ? offset + summaries.length : null,
  });
}

async function requireExecution(
  handles: StudioHandles,
  id: string,
): Promise<Execution | null> {
  return await handles.store.getExecution(id);
}

/** Falls back to a generated graph when the workflow has no catalog entry. */
function resolveWorkflow(
  execution: Execution,
  steps: StepResult[],
): StudioWorkflow {
  const known = getWorkflow(execution.workflowKey);
  if (known) return known;
  return {
    key: execution.workflowKey,
    title: execution.workflowKey,
    category: "unknown",
    description: "No catalog entry — graph generated from persisted steps.",
    signals: [],
    presets: [],
    graph: {
      nodes: steps.map((step) => ({
        id: step.stepId,
        kind: "step" as const,
        label: step.stepId,
        description: "",
      })),
      edges: [],
    },
  };
}

export async function getExecutionDetail(
  handles: StudioHandles,
  id: string,
): Promise<ApiResponse> {
  const { execution, steps, audit } =
    await handles.operator.getExecutionDetail(id);
  if (!execution) return notFound(`Unknown execution '${id}'.`);
  const workflow = resolveWorkflow(execution, steps);
  const [children, signalStates, parent] = await Promise.all([
    handles.operator.listChildExecutions(execution.id),
    handles.operator.listSignals(execution.id),
    execution.parentExecutionId
      ? handles.store.getExecution(execution.parentExecutionId)
      : Promise.resolve(null),
  ]);
  const childSummaries = await Promise.all(
    children.map((child) => toSummary(handles, child)),
  );
  const parentSummary = parent ? await toSummary(handles, parent) : null;
  const detail: StudioExecutionDetail = {
    id: execution.id,
    ...(execution.parentExecutionId
      ? { parentExecutionId: execution.parentExecutionId }
      : {}),
    workflowKey: execution.workflowKey,
    workflowTitle: workflow.title,
    status: execution.status,
    attempt: execution.attempt,
    maxAttempts: execution.maxAttempts,
    input: jsonSafe(execution.input),
    result: jsonSafe(execution.result ?? null),
    error: execution.error
      ? {
          message: execution.error.message,
          ...(execution.error.stack
            ? { stack: execution.error.stack }
            : {}),
          ...(execution.error.stepId
            ? { stepId: execution.error.stepId }
            : {}),
        }
      : null,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
    position: describePosition(execution, steps, workflow),
    timeline: projectTimeline(workflow, execution, steps),
    edges: workflow.graph.edges,
    steps: steps.map(toStepDto),
    audit: audit.map(toAuditDto),
    signals: signalStates.map(toSignalDto),
    relations: {
      parent: parentSummary,
      children: childSummaries,
    },
  };
  return ok({ execution: detail });
}

function readOperatorAction(input: unknown):
  | { stepId: string; reason: string; result?: unknown }
  | ApiResponse {
  if (typeof input !== "object" || input === null) {
    return badRequest("Body must include 'stepId' and 'reason'.");
  }
  const body = input as Record<string, unknown>;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (stepId === "" || reason === "") {
    return badRequest("Body must include non-empty 'stepId' and 'reason' strings.");
  }
  return {
    stepId,
    reason,
    ...(Object.prototype.hasOwnProperty.call(body, "result")
      ? { result: body.result }
      : {}),
  };
}

async function appendOperatorNote(
  handles: StudioHandles,
  execution: Execution,
  message: string,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!handles.store.appendAuditEntry) return;
  const at = new Date();
  await handles.store.appendAuditEntry({
    id: createDurableAuditEntryId(at.getTime()),
    executionId: execution.id,
    workflowKey: execution.workflowKey,
    attempt: execution.attempt,
    at,
    kind: DurableAuditEntryKind.Note,
    message,
    meta,
  });
}

export async function skipExecutionStep(
  handles: StudioHandles,
  id: string,
  input: unknown,
): Promise<ApiResponse> {
  const action = readOperatorAction(input);
  if ("status" in action) return action;
  const execution = await requireExecution(handles, id);
  if (!execution) return notFound(`Unknown execution '${id}'.`);
  await handles.operator.skipStep(id, action.stepId);
  await appendOperatorNote(handles, execution, "Operator skipped a step", {
    stepId: action.stepId,
    reason: action.reason,
  });
  return accepted({ skipped: true });
}

export async function editExecutionState(
  handles: StudioHandles,
  id: string,
  input: unknown,
): Promise<ApiResponse> {
  const action = readOperatorAction(input);
  if ("status" in action) return action;
  if (!("result" in action)) {
    return badRequest("Body must include the replacement 'result'.");
  }
  const execution = await requireExecution(handles, id);
  if (!execution) return notFound(`Unknown execution '${id}'.`);
  await handles.operator.editState(id, action.stepId, action.result);
  await appendOperatorNote(handles, execution, "Operator edited step state", {
    stepId: action.stepId,
    reason: action.reason,
  });
  return accepted({ edited: true });
}

export async function sendSignal(
  handles: StudioHandles,
  id: string,
  input: unknown,
): Promise<ApiResponse> {
  if (typeof input !== "object" || input === null) {
    return badRequest("Body must be an object with 'signal' and 'payload'.");
  }
  const { signal, payload } = input as Record<string, unknown>;
  if (typeof signal !== "string" || !(signal in SIGNALS_BY_ID)) {
    return badRequest(
      `Unknown signal '${String(signal)}'. Known: ${Object.keys(SIGNALS_BY_ID).join(", ")}.`,
    );
  }
  const execution = await requireExecution(handles, id);
  if (!execution) return notFound(`Unknown execution '${id}'.`);
  if (isTerminalStatus(execution.status)) {
    return conflict(
      `Execution '${id}' is already ${execution.status}; signals are ignored.`,
    );
  }
  switch (signal) {
    case PaymentConfirmed.id: {
      const validated = validateApiPayload(
        `Payload for signal '${PaymentConfirmed.id}'`,
        paymentConfirmedPayloadSchema,
        payload,
      );
      if (!validated.ok) return validated.response;
      await handles.durable.signal(
        id,
        PaymentConfirmed,
        validated.value,
      );
      break;
    }
    case EmailVerified.id: {
      const validated = validateApiPayload(
        `Payload for signal '${EmailVerified.id}'`,
        emailVerifiedPayloadSchema,
        payload,
      );
      if (!validated.ok) return validated.response;
      await handles.durable.signal(
        id,
        EmailVerified,
        validated.value,
      );
      break;
    }
    case IncidentAcknowledged.id: {
      const validated = validateApiPayload(
        `Payload for signal '${IncidentAcknowledged.id}'`,
        incidentAcknowledgedPayloadSchema,
        payload,
      );
      if (!validated.ok) return validated.response;
      await handles.durable.signal(
        id,
        IncidentAcknowledged,
        validated.value,
      );
      break;
    }
    case ApprovalDecision.id: {
      const validated = validateApiPayload(
        `Payload for signal '${ApprovalDecision.id}'`,
        approvalDecisionPayloadSchema,
        payload,
      );
      if (!validated.ok) return validated.response;
      await handles.durable.signal(
        id,
        ApprovalDecision,
        validated.value,
      );
      break;
    }
    default:
      return badRequest(
        `Unknown signal '${signal}'. Known: ${Object.keys(SIGNALS_BY_ID).join(", ")}.`,
      );
  }
  return accepted({ delivered: true });
}

export async function cancelExecution(
  handles: StudioHandles,
  id: string,
): Promise<ApiResponse> {
  const execution = await requireExecution(handles, id);
  if (!execution) return notFound(`Unknown execution '${id}'.`);
  if (isTerminalStatus(execution.status)) {
    return conflict(`Execution '${id}' is already ${execution.status}.`);
  }
  await handles.durable.cancelExecution(id, "Cancelled from studio");
  return accepted({ cancelled: true });
}

export async function retryExecution(
  handles: StudioHandles,
  id: string,
): Promise<ApiResponse> {
  const execution = await requireExecution(handles, id);
  if (!execution) return notFound(`Unknown execution '${id}'.`);
  if (
    execution.status !== "failed" &&
    execution.status !== "compensation_failed" &&
    execution.status !== "cancelled"
  ) {
    return conflict(
      `Only failed, compensation_failed or cancelled executions can be retried (now ${execution.status}).`,
    );
  }
  await handles.operator.retryRollback(id);
  await handles.durable.recover();
  return accepted({ retried: true });
}

function toScheduleDto(schedule: Schedule): StudioSchedule {
  return {
    id: schedule.id,
    workflowKey: schedule.workflowKey,
    workflowTitle: workflowTitle(schedule.workflowKey),
    type: schedule.type,
    pattern: schedule.pattern,
    ...(schedule.timezone ? { timezone: schedule.timezone } : {}),
    input: jsonSafe(schedule.input),
    status: schedule.status,
    lastRun: schedule.lastRun?.toISOString() ?? null,
    nextRun: schedule.nextRun?.toISOString() ?? null,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

export async function listSchedules(
  handles: StudioHandles,
): Promise<ApiResponse> {
  const schedules = await handles.durable.listSchedules();
  return ok({ schedules: schedules.map(toScheduleDto) });
}

export async function createSchedule(
  handles: StudioHandles,
  input: unknown,
): Promise<ApiResponse> {
  if (typeof input !== "object" || input === null) {
    return badRequest("Body must be an object describing the schedule.");
  }
  const {
    workflow,
    input: scheduleInput,
    id,
    cron,
    interval,
    at,
    delay,
    timezone,
  } = input as Record<string, unknown>;
  if (typeof workflow !== "string" || !(workflow in TASKS_BY_KEY)) {
    return badRequest(
      `Unknown workflow '${String(workflow)}'. Known: ${Object.keys(TASKS_BY_KEY).join(", ")}.`,
    );
  }
  const inputError = validateWorkflowInput(workflow, scheduleInput);
  if (inputError) return inputError;
  const setCount = [cron, interval, at, delay].filter(
    (value) => value !== undefined,
  ).length;
  if (setCount !== 1) {
    return badRequest(
      "Provide exactly one of 'cron', 'interval' (ms), 'at' (ISO date) or 'delay' (ms).",
    );
  }
  if (id !== undefined && typeof id !== "string") {
    return badRequest("Schedule 'id' must be a string when provided.");
  }
  if (timezone !== undefined && typeof timezone !== "string") {
    return badRequest("Schedule 'timezone' must be a string when provided.");
  }
  if (timezone !== undefined && typeof cron !== "string") {
    return badRequest("Schedule 'timezone' is only valid with 'cron'.");
  }
  try {
    let scheduleId: string;
    if (typeof cron === "string") {
      scheduleId =
        id === undefined
          ? await scheduleFor(handles, workflow, scheduleInput, {
              cron,
              ...(typeof timezone === "string" ? { timezone } : {}),
            })
          : await ensureScheduleFor(handles, workflow, scheduleInput, {
              id,
              cron,
              ...(typeof timezone === "string" ? { timezone } : {}),
            });
    } else if (typeof interval === "number") {
      scheduleId =
        id === undefined
          ? await scheduleFor(handles, workflow, scheduleInput, { interval })
          : await ensureScheduleFor(handles, workflow, scheduleInput, {
              id,
              interval,
            });
    } else if (typeof at === "string" || typeof delay === "number") {
      if (id !== undefined) {
        return badRequest("One-time schedules (at/delay) take no 'id'.");
      }
      scheduleId = await scheduleFor(handles, workflow, scheduleInput, {
        ...(typeof at === "string" ? { at: new Date(at) } : {}),
        ...(typeof delay === "number" ? { delay } : {}),
      });
    } else {
      return badRequest(
        "'cron' must be a string, 'interval'/'delay' numbers, 'at' an ISO date.",
      );
    }
    return created({ scheduleId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid schedule.";
    return badRequest(message);
  }
}

export function previewSchedule(input: unknown, now = new Date()): ApiResponse {
  if (typeof input !== "object" || input === null) {
    return badRequest("Body must describe a schedule cadence.");
  }
  const { cron, interval, at, delay, timezone } = input as Record<
    string,
    unknown
  >;
  const setCount = [cron, interval, at, delay].filter(
    (value) => value !== undefined,
  ).length;
  if (setCount !== 1) {
    return badRequest("Provide exactly one cadence to preview.");
  }
  if (timezone !== undefined && typeof timezone !== "string") {
    return badRequest("Schedule 'timezone' must be a string.");
  }
  if (timezone !== undefined && typeof cron !== "string") {
    return badRequest("Schedule 'timezone' is only valid with 'cron'.");
  }

  try {
    let fires: Date[];
    if (typeof cron === "string") {
      let cursor = now;
      fires = Array.from({ length: 3 }, () => {
        const next = CronParser.getNextRun(
          cron,
          cursor,
          typeof timezone === "string" ? timezone : undefined,
        );
        cursor = new Date(next.getTime() + 1);
        return next;
      });
    } else if (
      typeof interval === "number" &&
      Number.isFinite(interval) &&
      interval > 0
    ) {
      fires = [1, 2, 3].map(
        (multiple) => new Date(now.getTime() + interval * multiple),
      );
    } else if (typeof delay === "number" && Number.isFinite(delay) && delay > 0) {
      fires = [new Date(now.getTime() + delay)];
    } else if (typeof at === "string" && !Number.isNaN(new Date(at).getTime())) {
      const fire = new Date(at);
      if (fire.getTime() <= now.getTime()) {
        return badRequest("One-time fire must be in the future.");
      }
      fires = [fire];
    } else {
      return badRequest("Cadence must contain a valid cron, interval, delay or date.");
    }
    return ok({ fires: fires.map((fire) => fire.toISOString()) });
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Invalid schedule cadence.",
    );
  }
}

export async function updateSchedule(
  handles: StudioHandles,
  id: string,
  input: unknown,
): Promise<ApiResponse> {
  const schedule = await handles.durable.getSchedule(id);
  if (!schedule) return notFound(`Unknown schedule '${id}'.`);
  if (typeof input !== "object" || input === null) {
    return badRequest("Body must describe the schedule updates.");
  }
  const body = input as Record<string, unknown>;
  const hasInput = Object.prototype.hasOwnProperty.call(body, "input");
  const cron = body.cron;
  const interval = body.interval;
  const timezone = body.timezone;
  if (cron !== undefined && interval !== undefined) {
    return badRequest("Update either 'cron' or 'interval', not both.");
  }
  if (cron !== undefined && typeof cron !== "string") {
    return badRequest("Schedule 'cron' must be a string.");
  }
  if (
    interval !== undefined &&
    (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0)
  ) {
    return badRequest("Schedule 'interval' must be a positive number.");
  }
  if (timezone !== undefined && typeof timezone !== "string") {
    return badRequest("Schedule 'timezone' must be a string.");
  }
  if (timezone !== undefined && typeof cron !== "string") {
    return badRequest("Schedule 'timezone' is only valid with 'cron'.");
  }
  if (hasInput) {
    const inputError = validateWorkflowInput(schedule.workflowKey, body.input);
    if (inputError) return inputError;
  }

  try {
    if (typeof cron === "string") {
      await handles.durable.updateSchedule(id, {
        cron,
        ...(typeof timezone === "string" ? { timezone } : {}),
        ...(hasInput ? { input: body.input } : {}),
      });
    } else if (typeof interval === "number") {
      await handles.durable.updateSchedule(id, {
        interval,
        ...(hasInput ? { input: body.input } : {}),
      });
    } else {
      await handles.durable.updateSchedule(id, {
        ...(hasInput ? { input: body.input } : {}),
      });
    }
    return accepted({ updated: true });
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Invalid schedule update.",
    );
  }
}

async function ensureScheduleFor(
  handles: StudioHandles,
  workflow: string,
  input: unknown,
  options:
    | { id: string; cron: string; timezone?: string }
    | { id: string; interval: number },
): Promise<string> {
  // Trust boundary: operator-supplied JSON enters typed task input here.
  switch (workflow) {
    case "processOrder":
      return await handles.durable.ensureSchedule(
        processOrder,
        input as OrderInput,
        options,
      );
    case "userOnboarding":
      return await handles.durable.ensureSchedule(
        userOnboarding,
        input as OnboardingInput,
        options,
      );
    case "portfolioReconciliation":
      return await handles.durable.ensureSchedule(
        portfolioReconciliation,
        input as PortfolioReconciliationInput,
        options,
      );
    case "regionalRollup":
      return await handles.durable.ensureSchedule(
        regionalRollup,
        input as RegionalRollupInput,
        options,
      );
    case "incidentResponse":
      return await handles.durable.ensureSchedule(
        incidentResponse,
        input as IncidentInput,
        options,
      );
    default:
      throw new Error(`Unexpected workflow '${workflow}'.`);
  }
}

async function scheduleFor(
  handles: StudioHandles,
  workflow: string,
  input: unknown,
  options:
    | { cron: string; timezone?: string }
    | { interval: number }
    | { at?: Date; delay?: number },
): Promise<string> {
  // Trust boundary: operator-supplied JSON enters typed task input here.
  switch (workflow) {
    case "processOrder":
      return await handles.durable.schedule(
        processOrder,
        input as OrderInput,
        options,
      );
    case "userOnboarding":
      return await handles.durable.schedule(
        userOnboarding,
        input as OnboardingInput,
        options,
      );
    case "portfolioReconciliation":
      return await handles.durable.schedule(
        portfolioReconciliation,
        input as PortfolioReconciliationInput,
        options,
      );
    case "regionalRollup":
      return await handles.durable.schedule(
        regionalRollup,
        input as RegionalRollupInput,
        options,
      );
    case "incidentResponse":
      return await handles.durable.schedule(
        incidentResponse,
        input as IncidentInput,
        options,
      );
    default:
      throw new Error(`Unexpected workflow '${workflow}'.`);
  }
}

export async function pauseSchedule(
  handles: StudioHandles,
  id: string,
): Promise<ApiResponse> {
  const schedule = await handles.durable.getSchedule(id);
  if (!schedule) return notFound(`Unknown schedule '${id}'.`);
  await handles.durable.pauseSchedule(id);
  return accepted({ paused: true });
}

export async function resumeSchedule(
  handles: StudioHandles,
  id: string,
): Promise<ApiResponse> {
  const schedule = await handles.durable.getSchedule(id);
  if (!schedule) return notFound(`Unknown schedule '${id}'.`);
  await handles.durable.resumeSchedule(id);
  return accepted({ resumed: true });
}

export async function removeSchedule(
  handles: StudioHandles,
  id: string,
): Promise<ApiResponse> {
  const schedule = await handles.durable.getSchedule(id);
  if (!schedule) return notFound(`Unknown schedule '${id}'.`);
  await handles.durable.removeSchedule(id);
  return accepted({ removed: true });
}

export async function listStuck(
  handles: StudioHandles,
): Promise<ApiResponse> {
  const executions = await handles.operator.listStuckExecutions();
  const summaries: StudioExecutionSummary[] = [];
  for (const execution of executions) {
    summaries.push(await toSummary(handles, execution));
  }
  return ok({ executions: summaries });
}

export async function recoverOrphans(
  handles: StudioHandles,
): Promise<ApiResponse> {
  const report = await handles.durable.recover();
  const summary: StudioRecoverReport = {
    scannedCount: report.scannedCount,
    recoveredCount: report.recoveredCount,
    skippedCount: report.skippedCount,
    failedCount: report.failedCount,
  };
  return accepted({ report: summary });
}

export async function forceFailExecution(
  handles: StudioHandles,
  id: string,
  input: unknown,
): Promise<ApiResponse> {
  const reason =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).reason
      : undefined;
  if (typeof reason !== "string" || reason.trim() === "") {
    return badRequest("Body must include a non-empty 'reason' string.");
  }
  const execution = await requireExecution(handles, id);
  if (!execution) return notFound(`Unknown execution '${id}'.`);
  if (isTerminalStatus(execution.status)) {
    return conflict(`Execution '${id}' is already ${execution.status}.`);
  }
  await handles.operator.forceFail(id, reason);
  return accepted({ failed: true });
}
