import type { ITask, IEventEmission } from "../../../defs";

export interface ProtocolErrorShape {
  code: string;
  message: string;
  details?: unknown;
  // Optional app error identity and payload (when server sends typed errors)
  id?: string;
  data?: unknown;
}

export interface ProtocolEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: ProtocolErrorShape;
  meta?: { protocolVersion?: string; traceId?: string; taskVersion?: string };
}

export interface TaskRequest {
  id: string;
  input?: unknown;
  plan?: unknown; // ExecutionPlan will plug here in Task 2
  context?: Record<string, unknown>;
  traceId?: string;
}

export interface EventRequest {
  id: string;
  payload?: unknown;
  returnPayload?: boolean;
  context?: Record<string, unknown>;
  traceId?: string;
}

export class TunnelError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly id?: string;
  public readonly data?: unknown;

  constructor(
    code: string,
    message: string,
    details?: unknown,
    extras?: { id?: string; data?: unknown },
  ) {
    super(message);
    this.name = "TunnelError";
    this.code = code;
    this.details = details;
    this.id = extras?.id;
    this.data = extras?.data;
  }
}

export function toTunnelError(
  input: unknown,
  fallbackMessage?: string,
): TunnelError {
  if (input instanceof Error) {
    return new TunnelError("UNKNOWN", input.message);
  }
  if (
    input &&
    typeof input === "object" &&
    "code" in input &&
    "message" in input
  ) {
    const typed = input as { code: unknown; message: unknown };
    if (typeof typed.message === "string" && typeof typed.code === "string") {
      const pe = input as ProtocolErrorShape;
      const msg = pe.message || fallbackMessage || "Tunnel error";
      return new TunnelError(pe.code, msg, pe.details, {
        id: pe.id,
        data: pe.data,
      });
    }
  }

  if (input && typeof input === "object" && "message" in input) {
    const typed = input as { message: unknown };
    if (typeof typed.message === "string") {
      return new TunnelError("UNKNOWN", typed.message);
    }
  }

  return new TunnelError(
    "UNKNOWN",
    (typeof input === "string" && input) || fallbackMessage || "Tunnel error",
  );
}

export function assertOkEnvelope<T>(
  envelope: ProtocolEnvelope<T> | undefined,
  opts?: { fallbackMessage?: string },
): T {
  if (!envelope || typeof envelope !== "object") {
    throw new TunnelError(
      "INVALID_RESPONSE",
      opts?.fallbackMessage || "Invalid or empty response",
    );
  }
  if (envelope.ok) {
    return envelope.result as T;
  }
  if (envelope.error) {
    return ((): never => {
      throw toTunnelError(envelope.error, opts?.fallbackMessage);
    })();
  }
  throw new TunnelError("UNKNOWN", opts?.fallbackMessage || "Tunnel error");
}

export async function runViaTunnel(
  runner: (
    task: ITask<any, any, any, any, any, any>,
    input?: unknown,
  ) => Promise<unknown>,
  task: ITask<any, any, any, any, any, any>,
  input?: unknown,
): Promise<unknown> {
  return runner(task, input);
}

export async function emitViaTunnel(
  runner: (emission: IEventEmission<any>) => Promise<unknown>,
  emission: IEventEmission<any>,
): Promise<void> {
  await runner(emission);
}
