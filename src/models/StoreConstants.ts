import { globalResources } from "../globals/globalResources";
import { requireContextMiddleware } from "../globals/middleware/requireContext.middleware";
import { retryMiddleware } from "../globals/middleware/retry.middleware";

export function getBuiltInResources(eventManager: any, store: any) {
  return [
    globalResources.eventManager.with(eventManager),
    globalResources.store.with(store),
    globalResources.queue,
  ];
}

export function getBuiltInMiddlewares() {
  return [
    { id: requireContextMiddleware.id, middleware: requireContextMiddleware },
    { id: retryMiddleware.id, middleware: retryMiddleware },
  ];
}