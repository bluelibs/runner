/**
 * Studio API client: one interface with live (fetch + SSE) and demo
 * (in-memory simulator) implementations so the UI never branches on mode.
 */
import type {
  StudioExecutionDetail,
  StudioExecutionPage,
  StudioExecutionSummary,
  StudioRecoverReport,
  StudioSchedule,
  StudioWorkflow,
} from "../../src/shared/types.js";
import type { WorkflowPage, WorkflowQuery } from "../../src/shared/workflowPage.js";

export interface ExecutionFilters {
  workflowKey?: string;
  status?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  executionId?: string;
}

export interface StudioApi {
  listWorkflowPage(query?: WorkflowQuery): Promise<WorkflowPage>;
  getWorkflow(key: string): Promise<StudioWorkflow>;
  listWorkflows(): Promise<StudioWorkflow[]>;
  listExecutions(filters?: ExecutionFilters): Promise<StudioExecutionSummary[]>;
  listExecutionPage(filters?: ExecutionFilters): Promise<StudioExecutionPage>;
  getExecution(id: string): Promise<StudioExecutionDetail>;
  startExecution(workflow: string, input: unknown): Promise<string>;
  sendSignal(id: string, signal: string, payload: unknown): Promise<void>;
  cancelExecution(id: string): Promise<void>;
  retryExecution(id: string): Promise<void>;
  pauseExecution(id: string): Promise<void>;
  resumeExecution(id: string): Promise<void>;
  restartExecution(id: string, input?: unknown): Promise<string>;
  forceFailExecution(id: string, reason: string): Promise<void>;
  skipStep(id: string, stepId: string, reason: string): Promise<void>;
  editState(
    id: string,
    stepId: string,
    result: unknown,
    reason: string,
  ): Promise<void>;
  listSchedules(): Promise<StudioSchedule[]>;
  createSchedule(body: Record<string, unknown>): Promise<string>;
  previewSchedule(body: Record<string, unknown>): Promise<string[]>;
  updateSchedule(id: string, body: Record<string, unknown>): Promise<void>;
  pauseSchedule(id: string): Promise<void>;
  resumeSchedule(id: string): Promise<void>;
  removeSchedule(id: string): Promise<void>;
  listStuck(): Promise<StudioExecutionSummary[]>;
  recover(): Promise<StudioRecoverReport>;
  subscribeExecution(
    id: string,
    onDetail: (detail: StudioExecutionDetail) => void,
  ): () => void;
  /**
   * Optional auth extensions. The locked demo implements both; the live
   * client leaves them unset and reads the token from session storage.
   */
  unlock?(token: string): Promise<void>;
  isLocked?(): boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseBody(response: Response): Promise<never> {
  const text = await response.text();
  if (text === "") return undefined as never;
  return JSON.parse(text) as never;
}

const TOKEN_KEY = "studio.token";

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private-mode storage failures just mean the next reload re-locks.
  }
}

export function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing cached — nothing to clear.
  }
}

export function createLiveApi(
  baseUrl = "",
  options: { getToken?: () => string | null } = {},
): StudioApi {
  const getToken = options.getToken ?? getStoredToken;
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = getToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await parseBody(response)) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        typeof parsed?.error === "string" ? parsed.error : response.statusText;
      throw new ApiError(response.status, message);
    }
    return parsed as T;
  }

  async function listExecutionPage(
    filters?: ExecutionFilters,
  ): Promise<StudioExecutionPage> {
    const params = new URLSearchParams();
    if (filters?.workflowKey) params.set("workflowKey", filters.workflowKey);
    if (filters?.status) params.set("status", filters.status);
    params.set("limit", String(filters?.limit ?? 100));
    if (filters?.offset !== undefined) params.set("offset", String(filters.offset));
    if (filters?.cursor) params.set("cursor", filters.cursor);
    if (filters?.executionId) params.set("executionId", filters.executionId);
    return await request<StudioExecutionPage>(
      "GET",
      `/api/executions?${params.toString()}`,
    );
  }

  const api: StudioApi = {
    listWorkflowPage: (query = {}) => {
      const params = new URLSearchParams();
      if (query.query) params.set("query", query.query);
      if (query.cursor) params.set("cursor", query.cursor);
      params.set("limit", String(query.limit ?? 20));
      return request("GET", `/api/workflows?${params}`);
    },
    getWorkflow: async (key) => (await request<{ workflow: StudioWorkflow }>("GET", `/api/workflows/${encodeURIComponent(key)}`)).workflow,
    listWorkflows: async () =>
      (await request<{ workflows: StudioWorkflow[] }>("GET", "/api/workflows"))
        .workflows,
    listExecutions: async (filters) =>
      (await listExecutionPage(filters)).executions,
    listExecutionPage,
    getExecution: async (id) =>
      (
        await request<{ execution: StudioExecutionDetail }>(
          "GET",
          `/api/executions/${encodeURIComponent(id)}`,
        )
      ).execution,
    startExecution: async (workflow, input) =>
      (
        await request<{ executionId: string }>("POST", "/api/executions", {
          workflow,
          input,
        })
      ).executionId,
    sendSignal: async (id, signal, payload) => {
      await request("POST", `/api/executions/${encodeURIComponent(id)}/signals`, {
        signal,
        payload,
      });
    },
    cancelExecution: async (id) => {
      await request("POST", `/api/executions/${encodeURIComponent(id)}/cancel`);
    },
    retryExecution: async (id) => {
      await request("POST", `/api/executions/${encodeURIComponent(id)}/retry`);
    },
    pauseExecution: async (id) => {
      await request("POST", `/api/executions/${encodeURIComponent(id)}/pause`);
    },
    resumeExecution: async (id) => {
      await request("POST", `/api/executions/${encodeURIComponent(id)}/resume`);
    },
    restartExecution: async (id, input) =>
      (
        await request<{ executionId: string }>(
          "POST",
          `/api/executions/${encodeURIComponent(id)}/restart`,
          input === undefined ? undefined : { input },
        )
      ).executionId,
    forceFailExecution: async (id, reason) => {
      await request(
        "POST",
        `/api/executions/${encodeURIComponent(id)}/force-fail`,
        { reason },
      );
    },
    skipStep: async (id, stepId, reason) => {
      await request("POST", `/api/executions/${encodeURIComponent(id)}/skip-step`, {
        stepId,
        reason,
      });
    },
    editState: async (id, stepId, result, reason) => {
      await request("POST", `/api/executions/${encodeURIComponent(id)}/edit-state`, {
        stepId,
        result,
        reason,
      });
    },
    listSchedules: async () =>
      (await request<{ schedules: StudioSchedule[] }>("GET", "/api/schedules"))
        .schedules,
    createSchedule: async (body) =>
      (await request<{ scheduleId: string }>("POST", "/api/schedules", body))
        .scheduleId,
    previewSchedule: async (body) =>
      (
        await request<{ fires: string[] }>(
          "POST",
          "/api/schedules/preview",
          body,
        )
      ).fires,
    updateSchedule: async (id, body) => {
      await request("PATCH", `/api/schedules/${encodeURIComponent(id)}`, body);
    },
    pauseSchedule: async (id) => {
      await request(
        "POST",
        `/api/schedules/${encodeURIComponent(id)}/pause`,
      );
    },
    resumeSchedule: async (id) => {
      await request(
        "POST",
        `/api/schedules/${encodeURIComponent(id)}/resume`,
      );
    },
    removeSchedule: async (id) => {
      await request("DELETE", `/api/schedules/${encodeURIComponent(id)}`);
    },
    listStuck: async () =>
      (await request<{ executions: StudioExecutionSummary[] }>("GET", "/api/stuck"))
        .executions,
    recover: async () =>
      (await request<{ report: StudioRecoverReport }>("POST", "/api/recover"))
        .report,
    subscribeExecution: (id, onDetail) => {
      let stopped = false;
      let timer: number | null = null;
      const poll = async () => {
        if (stopped) return;
        try {
          onDetail(await api.getExecution(id));
        } catch {
          // Transients resolve on the next tick; the list still refreshes.
        }
      };
      let source: EventSource | null = null;
      try {
        const token = getToken();
        const streamUrl =
          `/api/executions/${encodeURIComponent(id)}/stream` +
          (token ? `?token=${encodeURIComponent(token)}` : "");
        source = new EventSource(streamUrl);
        source.addEventListener("detail", (event) => {
          if (stopped) return;
          try {
            const parsed = JSON.parse((event as MessageEvent).data) as {
              execution: StudioExecutionDetail;
            };
            onDetail(parsed.execution);
          } catch {
            // Ignore malformed frames; polling below covers gaps.
          }
        });
        source.onerror = () => {
          if (stopped) return;
          source?.close();
          source = null;
          timer = window.setInterval(poll, 2000);
        };
      } catch {
        timer = window.setInterval(poll, 2000);
      }
      // Belt and suspenders: a slow poll covers missed SSE frames.
      const backup = window.setInterval(poll, 8000);
      void poll();
      return () => {
        stopped = true;
        source?.close();
        if (timer !== null) window.clearInterval(timer);
        window.clearInterval(backup);
      };
    },
  };
  return api;
}
