
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
  result: any;
  completedAt: string;
}

export interface Execution {
  id: string;
  taskId: string;
  status: ExecutionStatus;
  input: any;
  result?: any;
  error?: {
    message: string;
    stack?: string;
  };
  attempt: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps?: StepResult[];
}

export interface ListExecutionsOptions {
  status?: ExecutionStatus[];
  taskId?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  executions: {
    list: async (options: ListExecutionsOptions = {}): Promise<Execution[]> => {
      const params = new URLSearchParams();
      if (options.status?.length) params.set('status', options.status.join(','));
      if (options.taskId) params.set('taskId', options.taskId);
      if (options.limit) params.set('limit', String(options.limit));
      if (options.offset) params.set('offset', String(options.offset));
      
      const url = params.toString() ? `/api/executions?${params}` : '/api/executions';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch executions');
      return res.json();
    },
    get: async (id: string): Promise<Execution> => {
      const res = await fetch(`/api/executions/${id}`);
      if (!res.ok) throw new Error('Failed to fetch execution');
      return res.json();
    }
  },
  operator: {
    retryRollback: async (executionId: string) => {
      const res = await fetch('/api/operator/retryRollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId })
      });
      if (!res.ok) throw new Error('Failed to retry rollback');
    },
    skipStep: async (executionId: string, stepId: string) => {
      const res = await fetch('/api/operator/skipStep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId, stepId })
      });
      if (!res.ok) throw new Error('Failed to skip step');
    },
    forceFail: async (executionId: string, reason: string) => {
      const res = await fetch('/api/operator/forceFail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId, reason })
      });
      if (!res.ok) throw new Error('Failed to force fail');
    },
    editState: async (executionId: string, stepId: string, newState: any) => {
        const res = await fetch('/api/operator/editState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId, stepId, state: newState })
        });
        if (!res.ok) throw new Error('Failed to edit state');
    }
  }
};
