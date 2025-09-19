import type { IncomingMessage, ServerResponse } from "http";
import type { NodeExposureHttpCorsConfig } from "./resourceTypes";

interface ResolvedOrigin {
  value: string | null;
  vary: boolean;
}

function getRequestOrigin(req: IncomingMessage): string | undefined {
  const originHeader = (req.headers as any)["origin"];
  if (Array.isArray(originHeader)) return originHeader[0];
  if (typeof originHeader === "string") return originHeader;
  const OriginHeader = (req.headers as any)["Origin"];
  if (Array.isArray(OriginHeader)) return OriginHeader[0];
  if (typeof OriginHeader === "string") return OriginHeader;
}

function resolveOrigin(
  cfg: NodeExposureHttpCorsConfig | undefined,
  requestOrigin: string | undefined,
): ResolvedOrigin {
  // Defaults: allow all unless credentials requires echoing
  if (!cfg || cfg.origin === undefined || cfg.origin === null) {
    if (cfg && cfg.credentials) {
      return { value: requestOrigin ? requestOrigin : "null", vary: true };
    }
    return { value: "*", vary: false };
  }

  const spec: any = (cfg as any).origin;
  if (typeof spec === "string") {
    return { value: spec, vary: false };
  }
  if (Array.isArray(spec)) {
    const match = requestOrigin ? spec.indexOf(requestOrigin) >= 0 : false;
    return { value: match ? (requestOrigin as string) : null, vary: true };
  }
  if (spec instanceof RegExp) {
    const ok = requestOrigin ? spec.test(requestOrigin) : false;
    return { value: ok ? (requestOrigin as string) : null, vary: true };
  }
  if (typeof spec === "function") {
    const out = spec(requestOrigin);
    return { value: out ? out : null, vary: true };
  }
  return { value: null, vary: false };
}

function appendVaryHeader(res: ServerResponse, field: string): void {
  const prev = res.getHeader("Vary");
  if (!prev) {
    res.setHeader("Vary", field);
    return;
  }
  const prevStr = Array.isArray(prev) ? prev.join(", ") : String(prev);
  const parts = prevStr
    .split(/\s*,\s*/)
    .map(function (s) {
      return s.trim();
    })
    .filter(function (s) {
      return !!s;
    });
  if (parts.indexOf(field) < 0) parts.push(field);
  res.setHeader("Vary", parts.join(", "));
}

export function applyCorsActual(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: NodeExposureHttpCorsConfig | undefined,
): void {
  if (!cfg) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return;
  }
  const originHeader = getRequestOrigin(req);
  const resolved = resolveOrigin(cfg, originHeader);
  const varyOrigin = cfg.varyOrigin === undefined ? true : !!cfg.varyOrigin;
  if (resolved.vary && varyOrigin) appendVaryHeader(res, "Origin");
  if (resolved.value)
    res.setHeader("Access-Control-Allow-Origin", resolved.value);
  if (cfg.credentials)
    res.setHeader("Access-Control-Allow-Credentials", "true");
  if (cfg.exposedHeaders && cfg.exposedHeaders.length > 0) {
    res.setHeader(
      "Access-Control-Expose-Headers",
      cfg.exposedHeaders.join(", "),
    );
  }
}

export function handleCorsPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: NodeExposureHttpCorsConfig | undefined,
): boolean {
  if (req.method !== "OPTIONS") return false;

  const originHeader = getRequestOrigin(req);
  const resolved = resolveOrigin(cfg, originHeader);
  const varyOrigin =
    cfg && cfg.varyOrigin !== undefined ? !!cfg.varyOrigin : true;
  if (resolved.vary && varyOrigin) appendVaryHeader(res, "Origin");
  if (resolved.value)
    res.setHeader("Access-Control-Allow-Origin", resolved.value);

  const methods =
    cfg && Array.isArray(cfg.methods) && cfg.methods.length > 0
      ? cfg.methods
      : ["POST", "OPTIONS"];
  res.setHeader("Access-Control-Allow-Methods", methods.join(", "));

  const rawReqHeaders: any = (req.headers as any)[
    "access-control-request-headers"
  ];
  const requested = Array.isArray(rawReqHeaders)
    ? rawReqHeaders.join(", ")
    : rawReqHeaders
    ? String(rawReqHeaders)
    : "";
  const allowHeaders =
    cfg && Array.isArray(cfg.allowedHeaders) && cfg.allowedHeaders.length > 0
      ? cfg.allowedHeaders.join(", ")
      : requested;
  if (allowHeaders) res.setHeader("Access-Control-Allow-Headers", allowHeaders);

  if (cfg && cfg.credentials)
    res.setHeader("Access-Control-Allow-Credentials", "true");
  if (cfg && typeof cfg.maxAge === "number")
    res.setHeader("Access-Control-Max-Age", String(cfg.maxAge));

  res.statusCode = 204;
  res.setHeader("content-length", "0");
  const end = (res as any).end;
  if (typeof end === "function") end.call(res);
  return true;
}
