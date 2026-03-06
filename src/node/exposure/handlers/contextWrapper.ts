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

interface AsyncContextHydrationOptions {
  allowAsyncContext?: boolean;
  allowedAsyncContextIds?: readonly string[];
}

function readContextHeader(req: IncomingMessage): string | undefined {
  const rawHeader = req.headers["x-runner-context"];
  if (Array.isArray(rawHeader)) return rawHeader[0];
  if (typeof rawHeader === "string") return rawHeader;
}

function wrapWithUserContexts<T>(
  req: IncomingMessage,
  deps: Pick<ExposureContextDeps, "store" | "serializer">,
  fn: () => Promise<T>,
  options?: AsyncContextHydrationOptions,
): () => Promise<T> {
  const { store, serializer } = deps;
  const allowAsyncContext = options?.allowAsyncContext !== false;
  const allowedIds =
    options?.allowedAsyncContextIds === undefined
      ? undefined
      : new Set(
          options.allowedAsyncContextIds
            .map((id) => store.resolveDefinitionId(id))
            .filter((id): id is string => Boolean(id)),
        );

  const headerText = readContextHeader(req);
  let userWrapped = fn;
  if (!allowAsyncContext || !headerText) {
    return userWrapped;
  }

  try {
    const map = serializer.parse<Record<string, string>>(headerText);
    for (const [id, ctx] of store.asyncContexts.entries()) {
      if (allowedIds && !allowedIds.has(id)) {
        continue;
      }
      const raw = map[id];
      if (typeof raw !== "string") {
        continue;
      }
      try {
        const value = ctx.parse(raw);
        const prev = userWrapped;
        userWrapped = async () => await ctx.provide(value, prev);
      } catch {
        // ignore parse/provide errors for individual contexts
      }
    }
  } catch {
    // ignore bad context header
  }

  return userWrapped;
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
  options?: AsyncContextHydrationOptions,
): Promise<T> => {
  const { store, router, serializer } = deps;
  const url = requestUrl(req);
  const userWrapped = wrapWithUserContexts(
    req,
    { store, serializer },
    fn,
    options,
  );

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
  return Promise.resolve(run());
};

/**
 * Builds user async contexts (if any), without exposure context (for events)
 */
export const withUserContexts = <T>(
  req: IncomingMessage,
  deps: Pick<ExposureContextDeps, "store" | "serializer">,
  fn: () => Promise<T>,
  options?: AsyncContextHydrationOptions,
): Promise<T> => {
  const { store, serializer } = deps;
  const userWrapped = wrapWithUserContexts(
    req,
    { store, serializer },
    fn,
    options,
  );

  return userWrapped();
};
