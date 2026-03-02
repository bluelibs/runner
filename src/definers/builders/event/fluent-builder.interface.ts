import type {
  EnsureTagsForTarget,
  EventTagType,
  IEvent,
  IEventMeta,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export interface EventFluentBuilder<
  TPayload = void,
  TTransactional extends boolean | undefined = undefined,
> {
  id: string;
  payloadSchema<TNew>(
    schema: ValidationSchemaInput<TNew>,
  ): EventFluentBuilder<TNew, TTransactional>;

  /**
   * Alias for payloadSchema. Use this to define the event payload validation contract.
   */
  schema<TNew>(
    schema: ValidationSchemaInput<TNew>,
  ): EventFluentBuilder<TNew, TTransactional>;

  tags<TNewTags extends EventTagType[]>(
    t: EnsureTagsForTarget<"events", TNewTags>,
    options?: { override?: boolean },
  ): EventFluentBuilder<TPayload, TTransactional>;

  /**
   * Declare errors that hooks assigned to this event might throw.
   * This is for documentation purposes only.
   */
  throws(list: ThrowsList): EventFluentBuilder<TPayload, TTransactional>;

  meta<TNewMeta extends IEventMeta>(
    m: TNewMeta,
  ): EventFluentBuilder<TPayload, TTransactional>;
  /**
   * Enable parallel execution for this event's listeners.
   * When enabled, listeners with the same `order` run concurrently within a batch.
   * Batches execute sequentially in ascending order priority.
   *
   * @param enabled - Whether to enable parallel execution (default: true)
   */
  parallel(enabled?: boolean): EventFluentBuilder<TPayload, TTransactional>;
  /**
   * Enable transactional execution for this event's listeners.
   * In transactional mode every listener must return an async undo closure.
   *
   * @param enabled - Whether transactional mode is enabled (default: true)
   */
  transactional<TEnabled extends boolean = true>(
    enabled?: TEnabled,
  ): EventFluentBuilder<TPayload, TEnabled>;
  build(): IEvent<TPayload> & { transactional?: TTransactional };
}
