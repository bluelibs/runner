import type {
  IEventDefinition,
  IEventMeta,
  IValidationSchema,
  TagType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { defineEvent } from "../../defineEvent";
import type { EventFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone, mergeArray } from "./utils";

/**
 * Creates an EventFluentBuilder from the given state.
 * Each builder method returns a new builder with updated state.
 */
export function makeEventBuilder<TPayload>(
  state: BuilderState<TPayload>,
): EventFluentBuilder<TPayload> {
  const builder: EventFluentBuilder<TPayload> = {
    id: state.id,

    payloadSchema<TNew>(schema: IValidationSchema<TNew>) {
      // Cast state to target type for widening, then assign the schema
      const next = clone(state as BuilderState<TNew>, {
        payloadSchema: schema,
      });
      return makeEventBuilder<TNew>(next);
    },

    schema<TNew>(schema: IValidationSchema<TNew>) {
      return builder.payloadSchema(schema);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeEventBuilder<TPayload>(next);
    },

    throws(_list) {
      // Throws is only for documentation on and Event, because events themselves don't throw.
      return builder;
    },

    meta<TNewMeta extends IEventMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as IEventMeta });
      return makeEventBuilder<TPayload>(next);
    },

    parallel(enabled = true) {
      const next = clone(state, { parallel: enabled });
      return makeEventBuilder<TPayload>(next);
    },

    build() {
      const event = defineEvent({
        ...(state as IEventDefinition<TPayload>),
      });
      (event as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      return event;
    },
  };

  return builder;
}
