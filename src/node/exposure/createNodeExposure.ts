import { createAuthenticator } from "./authenticator";
import { createAllowListGuard } from "./allowList";
import { createExposureServer } from "./exposureServer";
import { createRequestHandlers } from "./requestHandlers";
import { resolveBasePath, createRouter } from "./router";
import type {
  NodeExposureConfig,
  NodeExposureDeps,
  NodeExposureHandlers,
} from "./resourceTypes";
import type { AuthValidatorInput, AuthValidatorResult } from "./types";
import { globalTags } from "../../globals/globalTags";
import type { ITask } from "../../defs";

export async function createNodeExposure(
  cfg: NodeExposureConfig | undefined,
  deps: NodeExposureDeps,
): Promise<NodeExposureHandlers> {
  const { store, taskRunner, eventManager, logger, serializer } = deps;
  const httpConfig = cfg?.http;
  const basePath = resolveBasePath(httpConfig?.basePath);
  const router = createRouter(basePath);
  const allowList = createAllowListGuard(store);

  // Discover auth validator tasks
  const validatorTasks = store.getTasksWithTag(
    globalTags.authValidator,
  ) as ITask<AuthValidatorInput, Promise<AuthValidatorResult>, any>[];

  const authenticator = createAuthenticator(
    httpConfig?.auth,
    taskRunner,
    validatorTasks,
  );

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
      serializer,
      limits: httpConfig?.limits,
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
