import { resources } from "../../index";
import { defineResource } from "../../definers/defineResource";
import { debugConfig } from "../../globals/resources/debug";
import type { DebugConfig } from "../../globals/resources/debug";
import { eventLanesResourceConfigSchema } from "./configSchema";
import { EventLanesDiagnostics } from "./EventLanesDiagnostics";
import {
  EventLanesController,
  EventLanesCoreDependencies,
} from "./EventLanesController";
import {
  collectEventLaneQueueResourceDependencies,
  createDefaultEventLanesContext,
  EventLanesResourceContext,
} from "./EventLanesInternals";
import type { EventLanesResourceConfig } from "./types";

type EventLanesResourceDependencies = EventLanesCoreDependencies & {
  debugConfig?: DebugConfig;
};

type EventLanesDefinitionDependencies = {
  eventManager: typeof resources.eventManager;
  serializer: typeof resources.serializer;
  store: typeof resources.store;
  logger: typeof resources.logger;
  debugConfig: ReturnType<typeof debugConfig.optional>;
};

type EventLanesPrivateContext = EventLanesResourceContext & {
  controller?: EventLanesController;
};

export const EVENT_LANES_RESOURCE_ID = "eventLanes";

const eventLanesResourceBase = defineResource<
  EventLanesResourceConfig,
  Promise<unknown>,
  EventLanesDefinitionDependencies,
  EventLanesPrivateContext
>({
  id: EVENT_LANES_RESOURCE_ID,
  configSchema: eventLanesResourceConfigSchema,
  dependencies: (config: EventLanesResourceConfig) => ({
    eventManager: resources.eventManager,
    serializer: resources.serializer,
    store: resources.store,
    logger: resources.logger,
    debugConfig: debugConfig.optional(),
    ...collectEventLaneQueueResourceDependencies(config),
  }),
  context: () => createDefaultEventLanesContext() as EventLanesPrivateContext,
  init: async (config, dependencies, context) => {
    const typedDependencies =
      dependencies as unknown as EventLanesResourceDependencies;
    const diagnostics = EventLanesDiagnostics.fromDebugConfig(
      typedDependencies.logger,
      typedDependencies.debugConfig,
    );
    const controller = new EventLanesController(
      config,
      typedDependencies,
      context,
      diagnostics,
    );
    context.controller = controller;
    return controller.init();
  },
  cooldown: async (_value, _config, _dependencies, context) => {
    const controller = context.controller;
    if (controller) {
      await controller.cooldown();
      return;
    }
    await EventLanesController.cooldownContext(context);
  },
  dispose: async (_value, _config, _dependencies, context) => {
    const controller = context.controller;
    if (controller) {
      await controller.dispose();
      delete context.controller;
      return;
    }
    await EventLanesController.disposeContext(context);
  },
});

export const eventLanesResource = eventLanesResourceBase;
