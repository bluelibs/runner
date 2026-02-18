import type {
  IEvent,
  IEventMeta,
  IValidationSchema,
  TagType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export interface EventFluentBuilder<TPayload = void> {
  id: string;
  payloadSchema<TNew>(
    schema: IValidationSchema<TNew>,
  ): EventFluentBuilder<TNew>;

  /**
   * Alias for payloadSchema. Use this to define the event payload validation contract.
   */
  schema<TNew>(schema: IValidationSchema<TNew>): EventFluentBuilder<TNew>;

  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: boolean },
  ): EventFluentBuilder<TPayload>;

  /**
   * Declare errors that hooks assigned to this event might throw.
   * This is for documentation purposes only.
   */
  throws(list: ThrowsList): EventFluentBuilder<TPayload>;

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
