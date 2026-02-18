import type { IStepBuilder, StepOptions } from "./interfaces/context";
import type { DurableContext } from "./DurableContext";
import { durableStepDefinitionError } from "../../../errors";

/**
 * Fluent helper for building a durable step.
 *
 * This is the ergonomic layer behind `ctx.step("id")`:
 * - `up()` defines the memoized computation
 * - `down()` registers a compensation to be invoked by `ctx.rollback()`
 *
 * It is `PromiseLike`, so users can `await ctx.step("x").up(...).down(...)`.
 */
export class StepBuilder<T> implements IStepBuilder<T> {
  private upFn?: () => Promise<T>;
  private downFn?: (result: T) => Promise<void>;

  constructor(
    private readonly context: DurableContext,
    private readonly stepId: string,
    private readonly options: StepOptions = {},
  ) {}

  up(fn: () => Promise<T>): this {
    this.upFn = fn;
    return this;
  }

  down(fn: (result: T) => Promise<void>): this {
    this.downFn = fn;
    return this;
  }

  private async execute(): Promise<T> {
    if (!this.upFn) {
      durableStepDefinitionError.throw({ stepId: this.stepId });
    }

    return await this.context._executeStep(
      this.stepId,
      this.options,
      this.upFn!,
      this.downFn,
    );
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    const rejected: (reason: unknown) => TResult2 | PromiseLike<TResult2> =
      onrejected ??
      ((reason) => {
        throw reason;
      });

    return this.execute().then(onfulfilled, rejected) as Promise<
      TResult1 | TResult2
    >;
  }
}
