import type { IEventDefinition } from "../../../defs";

/**
 * Internal state for the EventFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<TPayload> = Readonly<
  Required<
    Pick<IEventDefinition<TPayload>, "id" | "meta" | "payloadSchema" | "tags">
  > &
    Pick<IEventDefinition<TPayload>, "parallel"> & {
      filePath: string;
    }
>;
