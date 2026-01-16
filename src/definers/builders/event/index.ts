import type { TagType } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeEventBuilder } from "./fluent-builder";
import type { EventFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Entry point for creating an event builder.
 */
export function eventBuilder<TPayload = void>(
  id: string,
): EventFluentBuilder<TPayload> {
  const filePath = getCallerFile();
  const initial: BuilderState<TPayload> = Object.freeze({
    id,
    filePath,
    meta: {} as BuilderState<TPayload>["meta"],
    payloadSchema: undefined,
    tags: [] as TagType[],
    parallel: undefined,
  });

  return makeEventBuilder(initial);
}

export const event = eventBuilder;
