import { jsonErrorResponse } from "./httpResponse";
import type { Authenticator } from "./types";

export interface NodeExposureHttpAuthConfig {
  header?: string;
  token: string;
}

export function createAuthenticator(
  authCfg?: NodeExposureHttpAuthConfig,
): Authenticator {
  if (!authCfg?.token) {
    return () => ({ ok: true });
  }
  const headerName = (authCfg.header ?? "x-runner-token").toLowerCase();
  return (req) => {
    const provided = headerValue(req.headers[headerName]);
    if (provided === authCfg.token) {
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
