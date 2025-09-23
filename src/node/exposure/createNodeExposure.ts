import { createAuthenticator } from "./authenticator";
import { createAllowListGuard } from "./allowList";
import { createExposureServer } from "./exposureServer";
import { createRequestHandlers } from "./requestHandlers";
import type { Serializer } from "../../globals/resources/tunnel/serializer";
import { resolveBasePath, createRouter } from "./router";
import type {
  NodeExposureConfig,
  NodeExposureDeps,
  NodeExposureHandlers,
} from "./resourceTypes";

export async function createNodeExposure(
  cfg: NodeExposureConfig | undefined,
  deps: NodeExposureDeps,
): Promise<NodeExposureHandlers> {
  const { store, taskRunner, eventManager, logger } = deps;
  const httpConfig = cfg?.http;
  const basePath = resolveBasePath(httpConfig?.basePath);
  const authenticator = createAuthenticator(httpConfig?.auth);
  const router = createRouter(basePath);
  const allowList = createAllowListGuard(store);

  const { handleTask, handleEvent, handleDiscovery, handleRequest } =
    createRequestHandlers({
      store,
      taskRunner,
      eventManager,
      logger,
      authenticator,
      allowList,
      router,
      cors: httpConfig?.cors,
      serializer: (deps as any).serializer as Serializer,
    });

  const serverControls = await createExposureServer({
    httpConfig,
    handler: handleRequest,
    logger,
    basePath,
  });

  return {
    handleRequest,
    handleTask,
    handleEvent,
    handleDiscovery,
    createRequestListener: serverControls.createRequestListener,
    createServer: serverControls.createServer,
    attachTo: serverControls.attachTo,
    server: serverControls.server,
    basePath,
    close: serverControls.close,
  };
}
