import { jsonErrorResponse } from "./httpResponse";
import type {
  Authenticator,
  AuthValidatorInput,
  AuthValidatorResult,
} from "./types";
import type { ITask } from "../../defs";
import type { TaskRunner } from "../../models/TaskRunner";

export interface NodeExposureHttpAuthConfig {
  header?: string;
  token?: string | string[];
}

export function createAuthenticator(
  authCfg: NodeExposureHttpAuthConfig | undefined,
  taskRunner: TaskRunner,
  validatorTasks: ITask<AuthValidatorInput, Promise<AuthValidatorResult>, any>[],
): Authenticator {
  const headerName = (authCfg?.header ?? "x-runner-token").toLowerCase();

  return async (req) => {
    const providedToken = headerValue(req.headers[headerName]);

    // 1. Static token check (fast path)
    if (authCfg?.token) {
      const tokens = Array.isArray(authCfg.token)
        ? authCfg.token
        : [authCfg.token];
      if (tokens.includes(providedToken)) {
        return { ok: true };
      }
    }

    // 2. Run validator tasks (OR logic - any success = allow)
    if (validatorTasks.length > 0) {
      const url = req.url ?? "/";
      const input: AuthValidatorInput = {
        headers: req.headers,
        method: req.method ?? "GET",
        url,
        path: new URL(url, "http://localhost").pathname,
      };

      for (const task of validatorTasks) {
        try {
          const result = await taskRunner.run(task, input);
          if (result?.ok) {
            return { ok: true };
          }
        } catch {
          // Validator threw - treat as rejection, continue to next
        }
      }
    }

    // 3. No token configured and no validators = open access (backwards compatible)
    if (!authCfg?.token && validatorTasks.length === 0) {
      return { ok: true };
    }

    return {
      ok: false,
      response: jsonErrorResponse(401, "Unauthorized", "UNAUTHORIZED"),
    };
  };
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
