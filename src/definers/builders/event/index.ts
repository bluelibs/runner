import type { EventTagType } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeEventBuilder } from "./fluent-builder";
import type { EventFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Creates a fluent event builder.
 *
 * Use this when payload schema, tags, and delivery semantics should stay explicit at the declaration site.
 */
export function eventBuilder<TPayload = void>(
  id: string,
): EventFluentBuilder<TPayload, undefined> {
  const filePath = getCallerFile();
  const initial: BuilderState<TPayload, undefined> = Object.freeze({
    id,
    filePath,
    meta: {} as BuilderState<TPayload, undefined>["meta"],
    payloadSchema: undefined,
    tags: [] as EventTagType[],
    parallel: undefined,
    transactional: undefined,
  });

  return makeEventBuilder<TPayload, undefined>(initial);
}

/**
 * Shorthand for {@link eventBuilder}.
 */
export const event = eventBuilder;
