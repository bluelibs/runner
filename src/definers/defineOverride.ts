import {
  ITask,
  IResource,
  ITaskMiddleware,
  IResourceMiddleware,
  IHook,
} from "../defs";

/**
 * Override helper that preserves the original `id` and returns the same type.
 * You can override any property except `id`. The override is shallow-merged over the base.
 *
 * @param base - The base definition to override.
 * @param patch - Properties to override (except `id`).
 * @returns A definition of the same kind with overrides applied.
 */
type OverridePatch<TBase> = Readonly<
  TBase extends IHook<any, any, any>
    ? Omit<Partial<TBase>, "id" | "on">
    : Omit<Partial<TBase>, "id">
>;

export function defineOverride<
  TBase extends
    | ITask<any, any, any, any, any, any>
    | IResource<any, any, any, any, any, any, any>
    | ITaskMiddleware<any, any, any, any>
    | IResourceMiddleware<any, any, any, any>
    | IHook<any, any, any>,
>(base: TBase, patch: OverridePatch<TBase>): TBase {
  const overridden = {
    ...base,
    ...patch,
    id: base.id,
  } as TBase;

  // Hooks should preserve the event binding identity as well.
  if ("on" in base && base.on !== undefined) {
    (overridden as unknown as IHook<any, any, any>).on = (
      base as IHook<any, any, any>
    ).on;
  }

  return overridden;
}
