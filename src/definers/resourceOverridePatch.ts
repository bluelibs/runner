import {
  DependencyMapType,
  IResource,
  IResourceMeta,
  ResourceMiddlewareAttachmentType,
  ResourceTagType,
} from "../defs";
import { overrideUnsupportedBaseError } from "../errors";

const resourceOverridePatchKeys = [
  "context",
  "init",
  "ready",
  "cooldown",
  "dispose",
] as const;

type ResourceOverridePatchKey = (typeof resourceOverridePatchKeys)[number];

type AtLeastOne<T> = {
  [K in keyof T]-?: { [P in K]-?: T[P] } & Partial<Omit<T, K>>;
}[keyof T];

export type ResourceOverridePatch<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
> = Readonly<
  AtLeastOne<
    Pick<
      IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
      ResourceOverridePatchKey
    >
  >
>;

const invalidKeysMessage = resourceOverridePatchKeys
  .map((key) => `"${key}"`)
  .join(", ");

export function normalizeResourceOverridePatch<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  _base: IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
  patch: Record<string, unknown>,
): ResourceOverridePatch<
  TConfig,
  TValue,
  TDeps,
  TContext,
  TMeta,
  TTags,
  TMiddleware
> {
  const patchKeys = Object.keys(patch);
  if (patchKeys.length === 0) {
    overrideUnsupportedBaseError.throw({
      message:
        'r.override() / defineOverride() resource patch object must include at least one of "context", "init", "ready", "cooldown", or "dispose".',
    });
  }

  const invalidKey = patchKeys.find(
    (key) =>
      !resourceOverridePatchKeys.includes(key as ResourceOverridePatchKey),
  );
  if (invalidKey) {
    overrideUnsupportedBaseError.throw({
      message: `r.override() / defineOverride() resource patch object contains unsupported key "${invalidKey}". Allowed keys: ${invalidKeysMessage}.`,
    });
  }

  for (const key of patchKeys) {
    if (typeof patch[key] !== "function") {
      overrideUnsupportedBaseError.throw({
        message: `r.override() / defineOverride() resource patch key "${key}" must be a function.`,
      });
    }
  }

  return patch as ResourceOverridePatch<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
}
