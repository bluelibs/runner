import { getDashboardBasePath } from "./basePath";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "retrying"
  | "sleeping"
  | "completed"
  | "compensation_failed"
  | "failed";

export interface StepResult {
  executionId: string;
  stepId: string;
  result: unknown;
  completedAt: string;
}

export interface AuditEntry {
  id: string;
  executionId: string;
  at: string;
  kind: string;
  attempt: number;
  taskId?: string;
  [k: string]: unknown;
}

export interface Execution {
  id: string;
  taskId: string;
  status: ExecutionStatus;
  input: unknown;
  result?: unknown;
  error?: {
    message: string;
    stack?: string;
  };
  attempt: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps?: StepResult[];
  audit?: AuditEntry[];
}

export interface ListExecutionsOptions {
  status?: ExecutionStatus[];
  taskId?: string;
  limit?: number;
  offset?: number;
}

function getApiBasePath(): string {
  const basePath = getDashboardBasePath();
  return `${basePath}/api`;
}

export const api = {
  executions: {
    list: async (options: ListExecutionsOptions = {}): Promise<Execution[]> => {
      const params = new URLSearchParams();
      if (options.status?.length) params.set("status", options.status.join(","));
      if (options.taskId) params.set("taskId", options.taskId);
      if (options.limit) params.set("limit", String(options.limit));
      if (options.offset) params.set("offset", String(options.offset));

      const apiBase = getApiBasePath();
      const url = params.toString()
        ? `${apiBase}/executions?${params}`
        : `${apiBase}/executions`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch executions");
      return res.json();
    },
    get: async (id: string): Promise<Execution> => {
      const apiBase = getApiBasePath();
      const res = await fetch(`${apiBase}/executions/${id}`);
      if (!res.ok) throw new Error("Failed to fetch execution");
      return res.json();
    },
  },
  operator: {
    retryRollback: async (executionId: string) => {
      const apiBase = getApiBasePath();
      const res = await fetch(`${apiBase}/operator/retryRollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId }),
      });
      if (!res.ok) throw new Error("Failed to retry rollback");
    },
    skipStep: async (executionId: string, stepId: string) => {
      const apiBase = getApiBasePath();
      const res = await fetch(`${apiBase}/operator/skipStep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, stepId }),
      });
      if (!res.ok) throw new Error("Failed to skip step");
    },
    forceFail: async (executionId: string, reason: string) => {
      const apiBase = getApiBasePath();
      const res = await fetch(`${apiBase}/operator/forceFail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, reason }),
      });
      if (!res.ok) throw new Error("Failed to force fail");
    },
    editState: async (executionId: string, stepId: string, newState: unknown) => {
      const apiBase = getApiBasePath();
      const res = await fetch(`${apiBase}/operator/editState`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, stepId, state: newState }),
      });
      if (!res.ok) throw new Error("Failed to edit state");
    },
  },
};
