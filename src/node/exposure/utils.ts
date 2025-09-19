import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "http";
import { CancellationError } from "../../errors";

/**
 * Extract a normalized Content-Type header value from request headers.
 * Returns an empty string if not present. If multiple values are present,
 * the first one is used.
 */
export function getContentType(headers: IncomingHttpHeaders): string {
  const raw = (headers as any)["content-type"];
  if (Array.isArray(raw)) return String(raw[0]);
  return String(raw ?? "");
}

/**
 * Attach an event listener to a Node-style emitter that may expose either
 * `once` or `on`. Returns true if attached, false otherwise.
 */
export function attachRequestListener(
  target: unknown,
  event: string,
  handler: (...args: unknown[]) => void,
): boolean {
  const anyTarget = target as { on?: Function; once?: Function };
  const add =
    typeof anyTarget?.once === "function"
      ? anyTarget.once.bind(anyTarget)
      : typeof anyTarget?.on === "function"
      ? anyTarget.on.bind(anyTarget)
      : undefined;
  if (!add) return false;
  add(event, handler);
  return true;
}

/**
 * Wires an AbortController to abort when the client disconnects.
 * Attaches to `req` aborted and `res` close events using robust listener attachment.
 */
export function createAbortControllerForRequest(
  req: IncomingMessage,
  res: ServerResponse,
): AbortController {
  const controller = new AbortController();
  const onAbort = () => {
    try {
      controller.abort(new CancellationError("Client Closed Request"));
    } catch {}
  };
  attachRequestListener(req, "aborted", onAbort);
  attachRequestListener(res, "close", onAbort);
  return controller;
}
