import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import { RuntimeTimers } from "../../models/runtime/RuntimeTimers";
import { storeResource } from "./store.resource";
import type { ITimers } from "../../types/timers";

type TimersResourceContext = {
  controller?: RuntimeTimers;
};

export const timersResource = defineResource<
  void,
  Promise<ITimers>,
  { store: typeof storeResource },
  TimersResourceContext
>(
  markFrameworkDefinition({
    id: "runner.timers",
    dependencies: { store: storeResource },
    context: () => ({}),
    init: async (_config, { store }, context) => {
      const controller = new RuntimeTimers(store.onUnhandledError);
      context.controller = controller;
      return controller;
    },
    cooldown: async (_timers, _config, _deps, context) => {
      context.controller?.cooldown();
    },
    dispose: async (_timers, _config, _deps, context) => {
      context.controller?.dispose();
    },
    meta: {
      title: "Timers",
      description:
        "Lifecycle-owned timers for polling, recovery loops, and delayed work inside resources.",
    },
  }),
);
