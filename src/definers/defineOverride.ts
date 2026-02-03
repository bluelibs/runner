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
type AnyTask = ITask<any, any, any, any, any, any>;
type AnyResource = IResource<any, any, any, any, any, any, any>;
type AnyTaskMiddleware = ITaskMiddleware<any, any, any, any>;
type AnyResourceMiddleware = IResourceMiddleware<any, any, any, any>;
type AnyHook = IHook<any, any, any>;

type AnyOverrideable =
  | AnyTask
  | AnyResource
  | AnyTaskMiddleware
  | AnyResourceMiddleware
  | AnyHook;

type OverridePatch<TBase extends AnyOverrideable> = Readonly<
  TBase extends AnyHook
    ? Omit<Partial<TBase>, "id" | "on">
    : Omit<Partial<TBase>, "id">
>;

export function defineOverride<TBase extends AnyOverrideable>(
  base: TBase,
  patch: OverridePatch<TBase>,
): TBase {
  const overridden = {
    ...base,
    ...patch,
    id: base.id,
  } as TBase;

  // Hooks should preserve the event binding identity as well.
  if ((base as AnyHook).on !== undefined) {
    (overridden as unknown as AnyHook).on = (base as AnyHook).on;
  }

  return overridden;
}
