import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "http";
import { cancellationError } from "../../errors";

/**
 * Extract a normalized Content-Type header value from request headers.
 * Returns an empty string if not present. If multiple values are present,
 * the first one is used.
 */
export function getContentType(headers: IncomingHttpHeaders): string {
  const raw = (headers as Record<string, unknown>)["content-type"];
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
  const createClientClosedRequestError = (): Error => {
    try {
      return cancellationError.throw({ reason: "Client Closed Request" });
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };

  const onAbort = () => {
    try {
      controller.abort(createClientClosedRequestError());
    } catch (abortError) {
      const normalized =
        abortError instanceof Error
          ? abortError
          : new Error(String(abortError));
      console.error("[runner] Failed to abort request controller.", {
        error: normalized,
      });
    }
  };
  attachRequestListener(req, "aborted", onAbort);
  attachRequestListener(res, "close", onAbort);
  return controller;
}
