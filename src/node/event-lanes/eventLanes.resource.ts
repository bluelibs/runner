import { resources } from "../../index";
import { debugConfig } from "../../globals/resources/debug";
import type { DebugConfig } from "../../globals/resources/debug";
import { frameworkResource } from "../../definers/builders/resource";
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
import { eventLanesResourceConfigSchema } from "./configSchema";

type EventLanesResourceDependencies = EventLanesCoreDependencies & {
  debugConfig?: DebugConfig;
};

type EventLanesPrivateContext = EventLanesResourceContext & {
  controller?: EventLanesController;
};

export const EVENT_LANES_RESOURCE_ID = "runner.node.eventLanes";

const eventLanesResourceBase = frameworkResource<EventLanesResourceConfig>(
  EVENT_LANES_RESOURCE_ID,
)
  .configSchema(eventLanesResourceConfigSchema)
  .dependencies({
    eventManager: resources.eventManager,
    serializer: resources.serializer,
    store: resources.store,
    logger: resources.logger,
    debugConfig: debugConfig.optional(),
  })
  .dependencies((config) => collectEventLaneQueueResourceDependencies(config))
  .context<EventLanesPrivateContext>(() => createDefaultEventLanesContext())
  .init(async (config, dependencies, context) => {
    const typedDependencies = dependencies as EventLanesResourceDependencies;
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
  })
  .cooldown(async (_value, _config, _dependencies, context) => {
    const controller = context.controller;
    if (controller) {
      await controller.cooldown();
      return;
    }
    await EventLanesController.cooldownContext(context);
  })
  .dispose(async (_value, _config, _dependencies, context) => {
    const controller = context.controller;
    if (controller) {
      await controller.dispose();
      delete context.controller;
      return;
    }
    await EventLanesController.disposeContext(context);
  })
  .build();

export const eventLanesResource = eventLanesResourceBase;
