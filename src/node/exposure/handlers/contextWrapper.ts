import type { IncomingMessage, ServerResponse } from "http";
import { ExposureRequestContext } from "../requestContext";
import type { NodeExposureDeps } from "../resourceTypes";
import type { SerializerLike } from "../../../serializer";
import { requestUrl } from "../router";

export interface ExposureContextDeps {
  store: NodeExposureDeps["store"];
  router: { basePath: string };
  serializer: SerializerLike;
}

/**
 * Builds a composed provider: first user async contexts (if any), then exposure context
 */
export const withExposureContext = <T>(
  req: IncomingMessage,
  res: ServerResponse,
  controller: AbortController,
  deps: ExposureContextDeps,
  fn: () => Promise<T>,
): Promise<T> => {
  const { store, router, serializer } = deps;
  const url = requestUrl(req);

  // Read context header if present
  const rawHeader = req.headers["x-runner-context"];
  let headerText: string | undefined;
  if (Array.isArray(rawHeader)) headerText = rawHeader[0];
  else if (typeof rawHeader === "string") headerText = rawHeader;

  let userWrapped = fn;
  if (headerText) {
    try {
      const map = serializer.parse<Record<string, string>>(headerText);
      // Compose provides for known contexts present in the map
      for (const [id, ctx] of store.asyncContexts.entries()) {
        const raw = map[id];
        if (typeof raw === "string") {
          try {
            const value = ctx.parse(raw);
            const prev = userWrapped;
            userWrapped = async () => await ctx.provide(value, prev);
          } catch {
            // ignore parse error of specific context
          }
        }
      }
    } catch {
      // ignore bad header
    }
  }

  // Always wrap with exposure request context
  const run = () =>
    ExposureRequestContext.provide(
      {
        req,
        res,
        url,
        basePath: router.basePath,
        headers: req.headers,
        method: req.method,
        signal: controller.signal,
      },
      userWrapped,
    );
  return run();
};

/**
 * Builds user async contexts (if any), without exposure context (for events)
 */
export const withUserContexts = <T>(
  req: IncomingMessage,
  deps: Pick<ExposureContextDeps, "store" | "serializer">,
  fn: () => Promise<T>,
): Promise<T> => {
  const { store, serializer } = deps;

  const rawHeader = req.headers["x-runner-context"];
  let headerText: string | undefined;
  if (Array.isArray(rawHeader)) headerText = rawHeader[0];
  else if (typeof rawHeader === "string") headerText = rawHeader;

  let userWrapped = fn;
  if (headerText) {
    try {
      const map = serializer.parse<Record<string, string>>(headerText);
      for (const [id, ctx] of store.asyncContexts.entries()) {
        const raw = map[id];
        if (typeof raw === "string") {
          try {
            const value = ctx.parse(raw);
            const prev = userWrapped;
            userWrapped = async () => await ctx.provide(value, prev);
          } catch {
            // ignore individual context error
          }
        }
      }
    } catch {
      // ignore bad header
    }
  }

  return userWrapped();
};
