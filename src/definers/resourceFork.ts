import type {
  DependencyMapType,
  IResource,
  RegisterableItems,
  ResourceForkOptions,
} from "../types/resource";
import { isOptional, isResource, isResourceWithConfig } from "./tools";

type AnyResource = IResource<any, any, any, any, any, any, any>;

export type ResourceRegisterList =
  | Array<RegisterableItems>
  | ((config: any) => Array<RegisterableItems>)
  | undefined;

function resolveReId(
  forkId: string,
  options: ResourceForkOptions | undefined,
): (id: string) => string {
  const fallback = (id: string) => `${forkId}.${id}`;
  const reId = options?.reId ?? fallback;
  return (id: string) => {
    const next = reId(id);
    if (typeof next !== "string" || next.length === 0) {
      throw new Error(`fork(reId) must return a non-empty string for "${id}"`);
    }
    return next;
  };
}

type DependenciesList<TConfig, TDeps extends DependencyMapType> =
  | TDeps
  | ((config: TConfig) => TDeps)
  | undefined;

function remapResourceDependenciesInObject<TDeps extends DependencyMapType>(
  deps: TDeps,
  options: {
    getForkedResourceByBaseId: (id: string) => IResource | undefined;
  },
): TDeps {
  const remapObject = (deps: TDeps): TDeps => {
    const out: Record<string, unknown> = { ...deps };
    for (const [key, value] of Object.entries(deps)) {
      if (isOptional(value)) {
        const inner = value.inner;
        if (isResource(inner)) {
          const forked = options.getForkedResourceByBaseId(inner.id);
          if (forked) {
            out[key] = { ...value, inner: forked };
          }
        }
        continue;
      }

      if (isResource(value)) {
        const forked = options.getForkedResourceByBaseId(value.id);
        if (forked) {
          out[key] = forked;
        }
      }
    }
    return out as TDeps;
  };

  return remapObject(deps);
}

function toResourceOnlyRegisterItems(
  items: Array<RegisterableItems>,
): Array<
  | { kind: "resource"; resource: AnyResource }
  | { kind: "withConfig"; resource: AnyResource; config: unknown }
> {
  const out: Array<
    | { kind: "resource"; resource: AnyResource }
    | { kind: "withConfig"; resource: AnyResource; config: unknown }
  > = [];
  for (const item of items) {
    if (isResourceWithConfig(item)) {
      out.push({
        kind: "withConfig",
        resource: item.resource,
        config: item.config,
      });
      continue;
    }
    if (isResource(item)) {
      out.push({ kind: "resource", resource: item });
      continue;
    }
  }
  return out;
}

function createDeepForkContext(
  forkId: string,
  options: ResourceForkOptions | undefined,
) {
  const reId = resolveReId(forkId, options);
  const forkedResourceByBaseId = new Map<string, AnyResource>();

  const ensureForked = (base: AnyResource): AnyResource => {
    const cached = forkedResourceByBaseId.get(base.id);
    if (cached) return cached;

    // Create the fork without any register changes, then patch register+deps
    // using the shared deep-fork context (so sibling dependencies can be remapped).
    const forked = base.fork(reId(base.id), { register: "drop" });
    forkedResourceByBaseId.set(base.id, forked);

    const baseRegister = base.register;

    const ensureForkedForRegisterConfig = (config: any) => {
      const items =
        typeof baseRegister === "function"
          ? baseRegister(config)
          : baseRegister;
      for (const candidate of toResourceOnlyRegisterItems(items)) {
        ensureForked(candidate.resource);
      }
      return items;
    };

    const mapRegisterItems = (items: Array<RegisterableItems>) => {
      const resourceItems = toResourceOnlyRegisterItems(items);
      const out: Array<RegisterableItems> = [];
      for (const candidate of resourceItems) {
        if (candidate.kind === "resource") {
          out.push(ensureForked(candidate.resource));
          continue;
        }
        out.push(ensureForked(candidate.resource).with(candidate.config));
      }
      return out;
    };

    forked.register =
      typeof baseRegister === "function"
        ? (config: any) => {
            const items = ensureForkedForRegisterConfig(config);
            return mapRegisterItems(items);
          }
        : (() => {
            ensureForkedForRegisterConfig(undefined);
            return mapRegisterItems(baseRegister);
          })();

    const baseDependencies = base.dependencies;
    const remapDepsObject = (deps: DependencyMapType) =>
      remapResourceDependenciesInObject(deps, {
        getForkedResourceByBaseId: (id) => forkedResourceByBaseId.get(id),
      });

    if (!baseDependencies) {
      forked.dependencies = baseDependencies;
    } else {
      // Always expose dependencies as a function in deep mode so remapping is order-independent
      // (and so config-dependent register lists can influence what gets remapped).
      forked.dependencies = (config: any) => {
        ensureForkedForRegisterConfig(config);
        const deps =
          typeof baseDependencies === "function"
            ? baseDependencies(config)
            : baseDependencies;
        return remapDepsObject(deps);
      };
    }

    return forked;
  };

  const ensureForkedForRegisterItems = (items: Array<RegisterableItems>) => {
    for (const candidate of toResourceOnlyRegisterItems(items)) {
      ensureForked(candidate.resource);
    }
  };

  const mapRegisterItems = (items: Array<RegisterableItems>) => {
    ensureForkedForRegisterItems(items);
    const resourceItems = toResourceOnlyRegisterItems(items);
    const out: Array<RegisterableItems> = [];
    for (const candidate of resourceItems) {
      if (candidate.kind === "resource") {
        out.push(ensureForked(candidate.resource));
        continue;
      }
      out.push(ensureForked(candidate.resource).with(candidate.config));
    }
    return out;
  };

  const remapDependencies = <TConfig, TDeps extends DependencyMapType>(
    dependencies: DependenciesList<TConfig, TDeps>,
  ): DependenciesList<TConfig, TDeps> => {
    if (!dependencies) return dependencies;

    const remapObj = (deps: TDeps) =>
      remapResourceDependenciesInObject(deps, {
        getForkedResourceByBaseId: (id) => forkedResourceByBaseId.get(id),
      });

    if (typeof dependencies === "function") {
      return (config: TConfig) => remapObj(dependencies(config));
    }
    return remapObj(dependencies);
  };

  return {
    reId,
    ensureForkedForRegisterItems,
    mapRegisterItems,
    remapDependencies,
    getForkedResourceByBaseId: (id: string) => forkedResourceByBaseId.get(id),
  };
}

export function resolveForkedRegisterAndDependencies<
  TConfig,
  TDeps extends DependencyMapType,
>(params: {
  register: ResourceRegisterList;
  dependencies: DependenciesList<TConfig, TDeps>;
  forkId: string;
  options: ResourceForkOptions | undefined;
}): {
  register: ResourceRegisterList;
  dependencies: DependenciesList<TConfig, TDeps>;
} {
  const { register, dependencies, forkId, options } = params;

  const mode = options?.register ?? "keep";
  if (mode === "drop") {
    return { register: [], dependencies };
  }
  if (mode !== "deep") {
    return { register, dependencies };
  }
  if (!register) {
    return { register, dependencies };
  }

  const ctx = createDeepForkContext(forkId, options);

  if (typeof register === "function") {
    return {
      register: (config: TConfig) => {
        const baseItems = register(config);
        return ctx.mapRegisterItems(baseItems);
      },
      dependencies: dependencies
        ? (config: TConfig) => {
            const baseItems = register(config);
            ctx.ensureForkedForRegisterItems(baseItems);

            const baseDeps =
              typeof dependencies === "function"
                ? dependencies(config)
                : dependencies;
            return remapResourceDependenciesInObject(baseDeps, {
              getForkedResourceByBaseId: ctx.getForkedResourceByBaseId,
            }) as unknown as TDeps;
          }
        : dependencies,
    };
  }

  ctx.ensureForkedForRegisterItems(register);
  return {
    register: ctx.mapRegisterItems(register),
    dependencies: ctx.remapDependencies(dependencies),
  };
}
