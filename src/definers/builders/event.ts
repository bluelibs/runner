import type {
  IEvent,
  IEventDefinition,
  IEventMeta,
  IValidationSchema,
  TagType,
} from "../../defs";
import { symbolFilePath } from "../../defs";
import { defineEvent } from "../defineEvent";
import { mergeArray } from "./utils";
import { getCallerFile } from "../../tools/getCallerFile";

type BuilderState<TPayload> = Readonly<
  Required<
    Pick<IEventDefinition<TPayload>, "id" | "meta" | "payloadSchema" | "tags">
  > &
    Pick<IEventDefinition<TPayload>, "parallel"> & {
      filePath: string;
    }
>;

function clone<TPayload>(
  s: BuilderState<TPayload>,
  patch: Partial<BuilderState<TPayload>>,
) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<TPayload>;
}

export interface EventFluentBuilder<TPayload = void> {
  id: string;
  payloadSchema<TNew>(
    schema: IValidationSchema<TNew>,
  ): EventFluentBuilder<TNew>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: boolean },
  ): EventFluentBuilder<TPayload>;
  meta<TNewMeta extends IEventMeta>(m: TNewMeta): EventFluentBuilder<TPayload>;
  /**
   * Enable parallel execution for this event's listeners.
   * When enabled, listeners with the same `order` run concurrently within a batch.
   * Batches execute sequentially in ascending order priority.
   *
   * @param enabled - Whether to enable parallel execution (default: true)
   */
  parallel(enabled?: boolean): EventFluentBuilder<TPayload>;
  build(): IEvent<TPayload>;
}

function makeEventBuilder<TPayload>(
  state: BuilderState<TPayload>,
): EventFluentBuilder<TPayload> {
  const b: EventFluentBuilder<any> = {
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
      const tags = mergeArray(state.tags as any, t as any, override);
      const next = clone(state, { tags: tags as any });
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
      (event as any)[symbolFilePath] = state.filePath;
      return event;
    },
  };
  return b as EventFluentBuilder<TPayload>;
}

export function eventBuilder(id: string): EventFluentBuilder<void> {
  const filePath = getCallerFile();
  const initial: BuilderState<void> = Object.freeze({
    id,
    filePath,
    meta: {} as any,
    payloadSchema: undefined as any,
    tags: [] as any,
    parallel: undefined,
  });
  return makeEventBuilder(initial);
}

export const event = eventBuilder;
