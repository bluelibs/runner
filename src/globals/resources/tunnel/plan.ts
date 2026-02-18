export type ValidationSide = "client" | "server" | "both";

export interface ExecutionPlan {
  clientMiddleware: string[];
  serverMiddleware: string[];
  validation: ValidationSide;
}

export interface PlanMeta {
  plan?: ExecutionPlan;
  headers?: Record<string, string>;
  traceId?: string;
  context?: unknown;
}

export function computeExecutionPlanFromWhitelist(
  whitelist: {
    client?: Array<string | { id: string }>;
    server?: Array<string | { id: string }>;
  },
  opts?: { defaultValidation?: ValidationSide },
): ExecutionPlan {
  const clientMiddleware = (whitelist.client || []).map((m) =>
    typeof m === "string" ? m : m.id,
  );
  const serverMiddleware = (whitelist.server || []).map((m) =>
    typeof m === "string" ? m : m.id,
  );
  return {
    clientMiddleware,
    serverMiddleware,
    validation: opts?.defaultValidation ?? "both",
  };
}
