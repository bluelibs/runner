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
      const next = clone(state, { payloadSchema: schema as any });
      return makeEventBuilder<TNew>(next as unknown as BuilderState<TNew>);
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

    meta<TNewMeta extends IEventMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as any });
      return makeEventBuilder<TPayload>(next);
    },

    parallel(enabled = true) {
      const next = clone(state, { parallel: enabled });
      return makeEventBuilder<TPayload>(next);
    },

    build() {
      const event = defineEvent({
        ...(state as unknown as IEventDefinition<TPayload>),
      });
      (event as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      return event;
    },
  };

  return builder;
}
