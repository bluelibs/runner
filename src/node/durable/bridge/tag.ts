import { defineTag } from "../../../definers/defineTag";
import { parseEventPolicy } from "./validation";
import type { DurableEventConfig } from "./types";

/** Marks an event for dispatch through the registered durable event bridge. */
export const durableEventTag = defineTag<
  DurableEventConfig,
  void,
  void,
  "events"
>({
  id: "durableEvent",
  targets: ["events"],
  meta: {
    title: "Durable Event",
    description: "Selects an event for persisted hook execution.",
  },
  config: {},
  configSchema: { parse: parseEventPolicy },
});
