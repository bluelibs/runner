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
// Narrowed helper types for better inference and diagnostics
type AnyTask = ITask<any, any, any, any, any, any>;
type AnyResource = IResource<any, any, any, any, any, any, any>;
type AnyTaskMiddleware = ITaskMiddleware<any, any, any, any>;
type AnyResourceMiddleware = IResourceMiddleware<any, any, any, any>;
type AnyHook = IHook<any, any, any>;

// Conditional patch type that maps the required/allowed fields based on base kind
type OverridePatch<T> = T extends AnyTask
  ? Omit<Partial<T>, "id"> & Pick<T, "run">
  : T extends AnyResource
    ? Omit<Partial<T>, "id"> & Pick<T, "init">
    : T extends AnyTaskMiddleware
      ? Omit<Partial<T>, "id">
      : T extends AnyResourceMiddleware
        ? Omit<Partial<T>, "id"> & Pick<T, "run">
        : T extends AnyHook
          ? Omit<Partial<T>, "id" | "on"> & Pick<T, "run">
          : never;

export function defineOverride<
  T extends
    | AnyTask
    | AnyResource
    | AnyTaskMiddleware
    | AnyResourceMiddleware
    | AnyHook,
>(base: T, patch: OverridePatch<T>): T {
  // Ensure we never change the id, and merge overrides last
  return {
    ...base,
    ...patch,
    id: base.id,
  } as unknown as T;
}
