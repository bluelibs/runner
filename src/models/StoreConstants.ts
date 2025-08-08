import { globalResources } from "../globals/globalResources";
import { requireContextMiddleware } from "../globals/middleware/requireContext.middleware";
import { retryMiddleware } from "../globals/middleware/retry.middleware";
import { timeoutMiddleware } from "../globals/middleware/timeout.middleware";
import { EventManager } from "./EventManager";
import { Store } from "./Store";

export function getBuiltInResources(eventManager: EventManager, store: Store) {
  return [
    globalResources.eventManager.with(eventManager),
    globalResources.store.with(store),
    globalResources.queue,
  ];
}

export function getBuiltInMiddlewares() {
  return [requireContextMiddleware, retryMiddleware, timeoutMiddleware];
}
