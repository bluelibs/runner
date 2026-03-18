import type {
  DisplayResourceSubtreePolicy,
  NormalizedResourceSubtreePolicy,
  ResourceSubtreePolicyDeclaration,
  ResourceSubtreePolicyInput,
} from "../types/subtree";
import type { RunnerMode } from "../types/runner";
import { mergeSubtreePolicyList } from "./subtreePolicy.merge";

export { normalizeResourceSubtreePolicy } from "./subtreePolicy.normalize";
export { mergeResourceSubtreePolicy } from "./subtreePolicy.merge";

export function createSubtreePolicyDeclaration<TConfig>(
  policy: ResourceSubtreePolicyInput<TConfig>,
  options?: {
    override?: boolean;
  },
): ResourceSubtreePolicyDeclaration<TConfig> {
  return {
    policy,
    ...(options ? { options: { override: options.override } } : {}),
  };
}

export function mergeResourceSubtreeDeclarations<TConfig>(
  existing:
    | ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>>
    | undefined,
  incoming: ResourceSubtreePolicyInput<TConfig>,
  options?: {
    override?: boolean;
  },
): ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>> {
  return Object.freeze([
    ...(existing ?? []),
    createSubtreePolicyDeclaration(incoming, options),
  ]);
}

export function resolveResourceSubtreeDeclarations<TConfig>(
  declarations:
    | ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>>
    | undefined,
  config: TConfig,
  mode?: RunnerMode,
): NormalizedResourceSubtreePolicy | undefined {
  if (!declarations) {
    return undefined;
  }

  return resolveNonEmptyResourceSubtreeDeclarations(declarations, config, mode);
}

function resolveNonEmptyResourceSubtreeDeclarations<TConfig>(
  declarations: ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>>,
  config: TConfig,
  mode?: RunnerMode,
): NormalizedResourceSubtreePolicy {
  let merged: NormalizedResourceSubtreePolicy = {};

  for (const declaration of declarations) {
    const policyList =
      typeof declaration.policy === "function"
        ? declaration.policy(config, mode)
        : declaration.policy;
    merged = mergeSubtreePolicyList(merged, policyList, declaration.options);
  }

  return merged;
}

export function createDisplaySubtreePolicy<TConfig>(
  declarations:
    | ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>>
    | undefined,
): DisplayResourceSubtreePolicy<TConfig> | undefined {
  if (!declarations || declarations.length === 0) {
    return undefined;
  }

  const hasDynamic = declarations.some(
    (declaration) => typeof declaration.policy === "function",
  );

  if (!hasDynamic) {
    return resolveNonEmptyResourceSubtreeDeclarations(
      declarations,
      {} as TConfig,
    );
  }

  return (config: TConfig, mode?: RunnerMode) =>
    resolveNonEmptyResourceSubtreeDeclarations(declarations, config, mode);
}

export function getStoredSubtreePolicy<TConfig>(resource: {
  subtree?:
    | DisplayResourceSubtreePolicy<TConfig>
    | ResourceSubtreePolicyInput<TConfig>;
}): NormalizedResourceSubtreePolicy | undefined {
  return resource.subtree as NormalizedResourceSubtreePolicy | undefined;
}
