import type {
  IEvent,
  IEventDefinition,
  IEventMeta,
  IValidationSchema,
  TagType,
} from "../../defs";
import { defineEvent } from "../defineEvent";
import { mergeArray } from "./utils";

type BuilderState<TPayload> = Readonly<
  Required<
    Pick<IEventDefinition<TPayload>, "id" | "meta" | "payloadSchema" | "tags">
  >
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
    tags<TNewTags extends TagType[]>(t: TNewTags, options?: { override?: boolean }) {
      const override = options?.override ?? false;
      const tags = mergeArray(state.tags as any, t as any, override);
      const next = clone(state, { tags: tags as any });
      return makeEventBuilder<TPayload>(next);
    },
    meta<TNewMeta extends IEventMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as any });
      return makeEventBuilder<TPayload>(next);
    },
    build() {
      return defineEvent({
        ...(state as unknown as IEventDefinition<TPayload>),
      });
    },
  };
  return b as EventFluentBuilder<TPayload>;
}

export function eventBuilder(id: string): EventFluentBuilder<void> {
  const initial: BuilderState<void> = Object.freeze({
    id,
    meta: {} as any,
    payloadSchema: undefined as any,
    tags: [] as any,
  });
  return makeEventBuilder(initial);
}

export const event = eventBuilder;
