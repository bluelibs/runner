import type { IncomingMessage } from "http";

import { NOT_FOUND_RESPONSE } from "./httpResponse";
import type { JsonResponse, RequestKind, RequestTarget } from "./types";

export interface ExposureRouter {
  basePath: string;
  isUnderBase(pathname: string): boolean;
  extract(pathname: string): RequestTarget | null;
}

export function resolveBasePath(basePath?: string): string {
  return trimTrailingSlash(ensureLeadingSlash(basePath ?? "/__runner"));
}

export function createRouter(basePath: string): ExposureRouter {
  const isUnderBase = (pathname: string) =>
    pathname === basePath || pathname.startsWith(basePath + "/");
  const extract = (pathname: string): RequestTarget | null => {
    if (!isUnderBase(pathname)) {
      return null;
    }
    const rest = pathname.slice(basePath.length);
    if (!rest || rest === "/") {
      return null;
    }
    const segments = rest.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    const [kind, ...idParts] = segments;
    if (kind !== "task" && kind !== "event") {
      return null;
    }
    const joined = idParts.join("/");
    let id: string;
    try {
      id = decodeURIComponent(joined);
    } catch {
      return null;
    }
    return { kind, id };
  };
  return { basePath, isUnderBase, extract };
}

export function resolveTargetFromRequest(
  req: IncomingMessage,
  router: ExposureRouter,
  expected: RequestKind,
): { ok: true; id: string } | { ok: false; response: JsonResponse } {
  const url = requestUrl(req);
  if (!router.isUnderBase(url.pathname)) {
    return { ok: false, response: NOT_FOUND_RESPONSE };
  }
  const target = router.extract(url.pathname);
  if (!target || target.kind !== expected) {
    return { ok: false, response: NOT_FOUND_RESPONSE };
  }
  return { ok: true, id: target.id };
}

export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url || "/", "http://localhost");
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function trimTrailingSlash(path: string): string {
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}
