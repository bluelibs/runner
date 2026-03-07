import type {
  IEventLaneMeta,
  IEventLaneTopology,
  IEventLaneTopologyBinding,
  IEventLaneTopologyProfile,
} from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeEventLaneBuilder } from "./fluent-builder";
import type { EventLaneFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

export function eventLaneBuilder(id: string): EventLaneFluentBuilder {
  const filePath = getCallerFile();
  const initial: BuilderState<IEventLaneMeta> = Object.freeze({
    id,
    filePath,
    meta: {} as IEventLaneMeta,
    applyTo: undefined,
    asyncContexts: undefined,
  });

  return makeEventLaneBuilder(initial);
}

export function eventLaneTopologyBuilder<
  const TBindings extends readonly IEventLaneTopologyBinding[],
  const TProfiles extends Record<
    string,
    IEventLaneTopologyProfile<TBindings[number]["lane"]>
  >,
>(
  topology: IEventLaneTopology<TBindings, TProfiles>,
): IEventLaneTopology<TBindings, TProfiles> {
  return deepFreeze(topology);
}

export interface EventLaneBuilderWithTopology {
  (id: string): EventLaneFluentBuilder;
  topology: typeof eventLaneTopologyBuilder;
}

export const eventLane: EventLaneBuilderWithTopology = Object.assign(
  eventLaneBuilder,
  {
    topology: eventLaneTopologyBuilder,
  },
);
