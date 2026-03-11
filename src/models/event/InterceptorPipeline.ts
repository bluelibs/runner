/**
 * Utility to compose an array of interceptors into a single function.
 * Interceptors execute in registration order (FIFO).
 */
export function composeInterceptors<TArgs extends any[], TResult>(
  interceptors: Array<
    (
      next: (...args: TArgs) => Promise<TResult>,
      ...args: TArgs
    ) => Promise<TResult>
  >,
  base: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return interceptors
    .slice()
    .reverse()
    .reduce(
      (next, interceptor) =>
        (...args: TArgs) =>
          interceptor(next, ...args),
      base,
    );
}
