import { globals, r } from "../../index";
import { debugConfig } from "../../globals/resources/debug";
import type { DebugConfig } from "../../globals/resources/debug";
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

const eventLanesResourceBase = r
  .resource<EventLanesResourceConfig>("globals.resources.node.eventLanes")
  .configSchema(eventLanesResourceConfigSchema)
  .dependencies({
    eventManager: globals.resources.eventManager,
    serializer: globals.resources.serializer,
    store: globals.resources.store,
    logger: globals.resources.logger,
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
