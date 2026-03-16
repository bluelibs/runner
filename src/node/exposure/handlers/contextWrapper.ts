import type { IncomingMessage, ServerResponse } from "http";
import { ExposureRequestContext } from "../requestContext";
import type { NodeExposureDeps } from "../resourceTypes";
import type { SerializerLike } from "../../../serializer";
import { requestUrl } from "../router";
import { withSerializedAsyncContexts } from "../../remote-lanes/asyncContextAllowlist";

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
  const headerText = readContextHeader(req);
  return async () =>
    withSerializedAsyncContexts({
      serializedContexts: headerText,
      registry: store.asyncContexts,
      serializer,
      fn,
      allowAsyncContext: options?.allowAsyncContext !== false,
      allowedAsyncContextIds: options?.allowedAsyncContextIds,
    });
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
