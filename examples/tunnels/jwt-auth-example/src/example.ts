/**
 * Local copy of the JWT tunnel example so package-local devDependencies resolve.
 */
import { r, run, globals } from "@bluelibs/runner";
import { nodeExposure, useExposureContext } from "@bluelibs/runner/node";
import type { IncomingHttpHeaders, ServerResponse } from "http";
import jwt from "jsonwebtoken";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import type { AddressInfo } from "net";

const BASE_PATH = "/__runner";
const ORIGIN = "http://127.0.0.1:7070";
const BASE_URL = `${ORIGIN}${BASE_PATH}`;
const JWT_SECRET = "demo-secret-key-change-me";

// Ensure platform is initialized for Node before any tunnel client usage
// setPlatform(new PlatformAdapter("node"));

interface JwtClaims {
  sub: string;
  scope: string[];
  exp?: number;
  [key: string]: unknown;
}

interface JwtAugmentedRequest {
  jwtClaims?: JwtClaims;
}

interface JwtMiddlewareConfig {
  requiredScopes?: string[];
}

const jwtGuard = r.middleware
  .task("examples.tunnels.jwt.guard")
  .everywhere((t) => t.id.startsWith("examples.tunnels.jwt."))
  .run(async (context, _deps, config?: JwtMiddlewareConfig) => {
    const nextInput = context.task?.input;
    let requestContext: ReturnType<typeof useExposureContext>;
    try {
      requestContext = useExposureContext();
    } catch {
      return context.next(nextInput);
    }
    const { req, res } = requestContext;
    const deny = (reason: string) => {
      writeUnauthorized(res, reason);
      return undefined as any;
    };
    const token = extractBearerToken(req.headers);
    if (!token) return deny("Missing bearer token");
    const verification = verifyJwt(token, JWT_SECRET);
    if (!verification.ok)
      return deny((verification as any).reason || "Invalid token");
    const claims = verification.claims;
    const requiredScopes = config?.requiredScopes ?? [];
    const missingScopes = requiredScopes.filter(
      (s) => !claims.scope.includes(s),
    );
    if (missingScopes.length > 0)
      return deny(`Missing scopes: ${missingScopes.join(", ")}`);
    (req as unknown as JwtAugmentedRequest).jwtClaims = claims;
    return context.next(nextInput);
  })
  .build();

type HelloTaskInput = { message: string };
type HelloTaskOutput = { message: string; user: string; scopes: string[] };

const helloTask = r
  .task("examples.tunnels.jwt.hello")
  .middleware([jwtGuard.with({ requiredScopes: ["tasks:read"] })])
  // Runner passes the task input directly to .run(), not wrapped in { input }
  .run(async (input: HelloTaskInput) => {
    const claims = getClaimsFromContext();
    return {
      message: input.message,
      user: claims.sub,
      scopes: [...claims.scope],
    };
  })
  .build();

const exposure = nodeExposure.with({
  http: { basePath: BASE_PATH, listen: { port: 7070, host: "127.0.0.1" } },
});

const callHelloDirect = r
  .task("examples.tunnels.jwt.client.call-direct")
  .dependencies(() => ({ hello: helloTask }))
  .run(async (_: void, deps) => {
    // Direct in-process task invocation (no HTTP tunnel)
    return deps.hello({ message: "Hello from direct call" });
  })
  .build();

const app = r
  .resource("examples.tunnels.jwt.app")
  .register([jwtGuard, helloTask, exposure, callHelloDirect])
  .build();

export async function runJwtAuthExample(): Promise<void> {
  const runner = await run(app);
  try {
    const direct = await runner.runTask(callHelloDirect);
    console.log("Direct call result:", direct);
  } finally {
    await runner.dispose();
  }
}

function extractBearerToken(headers: IncomingHttpHeaders): string | null {
  const raw = headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function getClaimsFromContext(): JwtClaims {
  // When running in-process (no HTTP exposure), there is no request context.
  // Fall back to a local identity so direct calls work without JWT.
  try {
    const { req } = useExposureContext();
    const claims = (req as unknown as JwtAugmentedRequest).jwtClaims;
    if (!claims) throw new Error("JWT claims missing in request context");
    return claims;
  } catch {
    return { sub: "local", scope: [] };
  }
}

function writeUnauthorized(res: ServerResponse, reason: string): void {
  if (res.writableEnded) return;
  const payload = JSON.stringify({
    ok: false,
    error: { code: "UNAUTHORIZED", message: reason },
  });
  res.statusCode = 401;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

type JwtVerifyResult =
  | { ok: true; claims: JwtClaims }
  | { ok: false; reason: string };
type SignJwtInput = Omit<JwtClaims, "exp">;

function verifyJwt(token: string, secret: string): JwtVerifyResult {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (!decoded || typeof decoded !== "object")
      return { ok: false, reason: "Unexpected JWT payload" };
    const payload = decoded as JwtPayload &
      Record<string, unknown> & { scope?: unknown };
    const {
      sub,
      exp,
      scope: rawScope,
      ...rest
    } = payload as Record<string, unknown> & {
      sub?: unknown;
      exp?: unknown;
      scope?: unknown;
    };
    if (typeof sub !== "string" || sub.length === 0)
      return { ok: false, reason: "Missing sub claim" };
    const scope = Array.isArray(rawScope)
      ? rawScope.filter((value): value is string => typeof value === "string")
      : [];
    const claims: JwtClaims = {
      ...rest,
      sub,
      scope,
      ...(typeof exp === "number" ? { exp } : {}),
    };
    return { ok: true, claims };
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "Invalid token";
    return { ok: false, reason: message };
  }
}

function signJwt(
  payload: SignJwtInput,
  secret: string,
  options?: { expiresInSeconds?: number },
): string {
  const signOptions: SignOptions = {
    algorithm: "HS256",
    ...(options?.expiresInSeconds != null
      ? { expiresIn: options.expiresInSeconds }
      : {}),
  };
  return jwt.sign(payload, secret, signOptions);
}

function buildBaseUrl(address: AddressInfo, basePath: string): string {
  const normalizedBase =
    basePath === "/"
      ? ""
      : basePath.endsWith("/")
      ? basePath.slice(0, -1)
      : basePath;
  return `http://127.0.0.1:${address.port}${normalizedBase}`;
}
