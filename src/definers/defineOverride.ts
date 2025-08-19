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
export function defineOverride<T extends ITask<any, any, any, any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id"> & Pick<T, "run">,
): T;
export function defineOverride<T extends IResource<any, any, any, any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id"> & Pick<T, "init">,
): T;
export function defineOverride<T extends ITaskMiddleware<any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id"> & Pick<T, "run">,
): T;
export function defineOverride<T extends IResourceMiddleware<any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id"> & Pick<T, "run">,
): T;
export function defineOverride<T extends IHook<any, any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id" | "on"> & Pick<T, "run">,
): T;
export function defineOverride(
  base: ITask | IResource | ITaskMiddleware | IResourceMiddleware,
  patch: Record<string, unknown>,
): ITask | IResource | ITaskMiddleware | IResourceMiddleware {
  const { id: _ignored, ...rest } = patch;
  // Ensure we never change the id, and merge overrides last
  return {
    ...(base as any),
    ...rest,
    id: (base as any).id,
  } as any;
}