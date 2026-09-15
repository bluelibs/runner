/**
 * Shared helpers for the studio test suites.
 *
 * Tests drive `dispatchApiRequest` — the same router the HTTP server uses —
 * so every suite exercises the real runtime without needing TCP sockets.
 */
import { dispatchApiRequest } from "./server/http.js";
import { bootStudio, type StudioHandles } from "./server/studioApp.js";
import type {
  StudioExecutionDetail,
  StudioExecutionSummary,
  StudioRecoverReport,
  StudioSchedule,
  StudioWorkflow,
} from "./shared/types.js";

export interface StudioTestClient {
  handles: StudioHandles;
  get<T>(path: string): Promise<{ status: number; body: T }>;
  post<T>(path: string, body?: unknown): Promise<{ status: number; body: T }>;
  patch<T>(path: string, body?: unknown): Promise<{ status: number; body: T }>;
  delete<T>(path: string): Promise<{ status: number; body: T }>;
  dispose: () => Promise<void>;
}

async function dispatch<T>(
  handles: StudioHandles,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const dispatched = await dispatchApiRequest(
    handles,
    method,
    new URL(path, "http://studio.local"),
    body,
  );
  if (dispatched.kind !== "json") {
    throw new Error(`Expected a JSON response for ${method} ${path}.`);
  }
  return { status: dispatched.status, body: dispatched.body as T };
}

export async function createTestStudio(): Promise<StudioTestClient> {
  const handles = await bootStudio();
  return {
    handles,
    get: (path) => dispatch(handles, "GET", path),
    post: (path, body) => dispatch(handles, "POST", path, body),
    patch: (path, body) => dispatch(handles, "PATCH", path, body),
    delete: (path) => dispatch(handles, "DELETE", path),
    dispose: () => handles.dispose(),
  };
}

export async function waitUntil(
  check: () => Promise<boolean>,
  options: { timeoutMs: number; intervalMs?: number; message: string },
): Promise<void> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? 25;
  for (;;) {
    if (await check()) return;
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error(`Timed out waiting: ${options.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function startWorkflow(
  client: StudioTestClient,
  workflow: string,
  input: unknown,
): Promise<string> {
  const started = await client.post<{ executionId: string }>("/api/executions", {
    workflow,
    input,
  });
  if (started.status !== 201) {
    throw new Error(
      `Failed to start ${workflow}: ${JSON.stringify(started.body)}`,
    );
  }
  return started.body.executionId;
}

export async function getDetail(
  client: StudioTestClient,
  executionId: string,
): Promise<StudioExecutionDetail> {
  const detail = await client.get<{ execution: StudioExecutionDetail }>(
    `/api/executions/${executionId}`,
  );
  if (detail.status !== 200) {
    throw new Error(
      `Failed to load ${executionId}: ${JSON.stringify(detail.body)}`,
    );
  }
  return detail.body.execution;
}

export async function waitForStatus(
  client: StudioTestClient,
  executionId: string,
  status: string,
  timeoutMs = 15_000,
): Promise<StudioExecutionDetail> {
  let detail = await getDetail(client, executionId);
  await waitUntil(
    async () => {
      detail = await getDetail(client, executionId);
      return detail.status === status;
    },
    { timeoutMs, message: `${executionId} to reach ${status}` },
  );
  return detail;
}

/** Waits until the execution parks on the given persisted step id. */
export async function waitForNodeState(
  client: StudioTestClient,
  executionId: string,
  stepId: string,
  state: string,
  timeoutMs = 15_000,
): Promise<StudioExecutionDetail> {
  let detail = await getDetail(client, executionId);
  await waitUntil(
    async () => {
      detail = await getDetail(client, executionId);
      return detail.timeline.some(
        (node) => node.id === stepId && node.state === state,
      );
    },
    { timeoutMs, message: `${executionId}:${stepId} to be ${state}` },
  );
  return detail;
}

export type {
  StudioExecutionDetail,
  StudioExecutionSummary,
  StudioRecoverReport,
  StudioSchedule,
  StudioWorkflow,
};
