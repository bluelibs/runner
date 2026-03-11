import type {
  EnsureTagsForTarget,
  IEvent,
  EventTagType,
  IEventDefinition,
  IEventMeta,
  ValidationSchemaInput,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineEvent } from "../../defineEvent";
import type { EventFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone, mergeArray } from "./utils";

/**
 * Creates an EventFluentBuilder from the given state.
 * Each builder method returns a new builder with updated state.
 */
export function makeEventBuilder<
  TPayload,
  TTransactional extends boolean | undefined,
>(
  state: BuilderState<TPayload, TTransactional>,
): EventFluentBuilder<TPayload, TTransactional> {
  const builder: EventFluentBuilder<TPayload, TTransactional> = {
    id: state.id,

    payloadSchema<TNew>(schema: ValidationSchemaInput<TNew>) {
      // Cast state to target type for widening, then assign the schema
      const next = clone(
        state as unknown as BuilderState<TNew, TTransactional>,
        {
          payloadSchema: schema,
        },
      );
      return makeEventBuilder<TNew, TTransactional>(next);
    },

    schema<TNew>(schema: ValidationSchemaInput<TNew>) {
      return builder.payloadSchema(schema);
    },

    tags<TNewTags extends EventTagType[]>(
      t: EnsureTagsForTarget<"events", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone(state, {
        tags: mergeArray(state.tags, t, override) as EventTagType[],
      });
      return makeEventBuilder<TPayload, TTransactional>(next);
    },

    throws(_list) {
      // Throws is only for documentation on and Event, because events themselves don't throw.
      return builder;
    },

    meta<TNewMeta extends IEventMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as IEventMeta });
      return makeEventBuilder<TPayload, TTransactional>(next);
    },

    parallel(enabled = true) {
      const next = clone(state, { parallel: enabled });
      return makeEventBuilder<TPayload, TTransactional>(next);
    },

    transactional<TEnabled extends boolean = true>(enabled?: TEnabled) {
      const next = Object.freeze({
        ...state,
        transactional: (enabled ?? true) as TEnabled,
      }) as BuilderState<TPayload, TEnabled>;
      return makeEventBuilder<TPayload, TEnabled>(next);
    },

    build() {
      const event = defineEvent({
        ...(state as IEventDefinition<TPayload>),
      });
      return deepFreeze({
        ...event,
        [symbolFilePath]: state.filePath,
      }) as IEvent<TPayload> & {
        transactional?: TTransactional;
      };
    },
  };

  return builder;
}
