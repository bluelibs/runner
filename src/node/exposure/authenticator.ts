import * as crypto from "node:crypto";
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
  /**
   * When true, allows unauthenticated access if no token or validators are configured.
   * Defaults to false (secure by default - requires explicit auth configuration).
   *
   * WARNING: Setting this to true without proper network isolation exposes
   * all tasks and events to unauthenticated access.
   */
  allowAnonymous?: boolean;
}

function safeCompare(a: string, b: string): boolean {
  try {
    const digestA = crypto.createHash("sha256").update(a).digest();
    const digestB = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(digestA, digestB);
  } catch {
    return false;
  }
}

export function createAuthenticator(
  authCfg: NodeExposureHttpAuthConfig | undefined,
  taskRunner: TaskRunner,
  validatorTasks: ITask<
    AuthValidatorInput,
    Promise<AuthValidatorResult>,
    any
  >[],
): Authenticator {
  const headerName = (authCfg?.header ?? "x-runner-token").toLowerCase();

  return async (req) => {
    const providedToken = headerValue(req.headers[headerName]);

    // 1. Static token check (fast path)
    if (authCfg?.token) {
      const tokens = Array.isArray(authCfg.token)
        ? authCfg.token
        : [authCfg.token];
      const match = tokens.some((token) => safeCompare(token, providedToken));
      if (match) {
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

    // 3. No token configured and no validators = check allowAnonymous flag
    // SECURITY: Fail-closed by default. Explicit opt-in required for anonymous access.
    if (!authCfg?.token && validatorTasks.length === 0) {
      if (authCfg?.allowAnonymous === true) {
        return { ok: true };
      }
      return {
        ok: false,
        response: jsonErrorResponse(
          500,
          "Authentication not configured.",
          "AUTH_NOT_CONFIGURED",
        ),
      };
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
