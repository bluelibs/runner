export type ComposedRunner<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => TResult;

export function composeReverseLayers<TArgs extends unknown[], TResult, TLayer>(
  runner: ComposedRunner<TArgs, TResult>,
  layers: readonly TLayer[],
  wrapLayer: (
    next: ComposedRunner<TArgs, TResult>,
    layer: TLayer,
  ) => ComposedRunner<TArgs, TResult>,
): ComposedRunner<TArgs, TResult> {
  let wrapped = runner;

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    wrapped = wrapLayer(wrapped, layers[index]);
  }

  return wrapped;
}
