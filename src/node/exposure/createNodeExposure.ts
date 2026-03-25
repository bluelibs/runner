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
import {
  EMPTY_NODE_EXPOSURE_POLICY,
  type NodeExposurePolicySnapshot,
} from "./policy";
import type { AuthValidatorInput, AuthValidatorResult } from "./types";
import type { ITask } from "../../defs";
import type { IncomingMessage } from "http";
import type { JsonResponse } from "./types";

export interface NodeExposureAuthorizationOptions {
  authorizeTask?: (
    req: IncomingMessage,
    taskId: string,
  ) => Promise<JsonResponse | null> | JsonResponse | null;
  authorizeEvent?: (
    req: IncomingMessage,
    eventId: string,
  ) => Promise<JsonResponse | null> | JsonResponse | null;
  authorizeTaskBody?: (
    req: IncomingMessage,
    taskId: string,
    bodyText?: string,
  ) => Promise<JsonResponse | null> | JsonResponse | null;
  authorizeEventBody?: (
    req: IncomingMessage,
    eventId: string,
    bodyText?: string,
  ) => Promise<JsonResponse | null> | JsonResponse | null;
}

export interface CreateNodeExposureOptions {
  authorization?: NodeExposureAuthorizationOptions;
  policy?: NodeExposurePolicySnapshot;
  sourceResourceId?: string;
}

export async function createNodeExposure(
  cfg: NodeExposureConfig | undefined,
  deps: NodeExposureDeps,
  options?: CreateNodeExposureOptions,
): Promise<NodeExposureHandlers> {
  const {
    store,
    authValidators,
    taskRunner,
    eventManager,
    logger,
    serializer,
  } = deps;
  const httpConfig = cfg?.http;
  const basePath = resolveBasePath(httpConfig?.basePath);
  const router = createRouter(basePath);
  const allowList = createAllowListGuard(
    options?.policy ?? EMPTY_NODE_EXPOSURE_POLICY,
  );

  // Discover auth validator tasks
  const validatorTasks: ITask<
    AuthValidatorInput,
    Promise<AuthValidatorResult>,
    any
  >[] = [];
  for (const entry of authValidators.tasks) {
    validatorTasks.push(
      entry.definition as ITask<
        AuthValidatorInput,
        Promise<AuthValidatorResult>,
        any
      >,
    );
  }

  const authenticator = createAuthenticator(
    httpConfig?.auth,
    store,
    taskRunner,
    validatorTasks,
    options?.sourceResourceId,
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
      disableDiscovery: httpConfig?.disableDiscovery,
      authorizeTask: options?.authorization?.authorizeTask,
      authorizeEvent: options?.authorization?.authorizeEvent,
      authorizeTaskBody: options?.authorization?.authorizeTaskBody,
      authorizeEventBody: options?.authorization?.authorizeEventBody,
      policy: options?.policy ?? EMPTY_NODE_EXPOSURE_POLICY,
      sourceResourceId: options?.sourceResourceId,
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
