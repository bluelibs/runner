import { isolateConflictError, isolateExportsConflictError } from "../errors";
import type {
  IsolationExportsTarget,
  IsolationPolicy,
  IsolationPolicyDeclaration,
  IsolationPolicyInput,
} from "../types/resource";

function mergeIsolationArrayField(
  existingField: unknown,
  incomingField: unknown,
  override: boolean,
): unknown {
  if (incomingField === undefined) {
    return existingField;
  }

  if (override) {
    return incomingField;
  }

  if (!Array.isArray(incomingField)) {
    return incomingField;
  }

  if (existingField === undefined) {
    return [...incomingField];
  }

  return Array.isArray(existingField)
    ? [...existingField, ...incomingField]
    : existingField;
}

export function mergeIsolationPolicy(
  existing: IsolationPolicy | undefined,
  policy: IsolationPolicy,
  options?: { override?: boolean },
  policyResourceId = "unknown",
): IsolationPolicy {
  const override = options?.override === true;
  const existingExports = existing?.exports;
  const merged: IsolationPolicy = {};

  const deny = mergeIsolationArrayField(existing?.deny, policy.deny, override);
  if (deny !== undefined) {
    merged.deny = deny as IsolationPolicy["deny"];
  }

  const only = mergeIsolationArrayField(existing?.only, policy.only, override);
  if (only !== undefined) {
    merged.only = only as IsolationPolicy["only"];
  }

  const whitelist = mergeIsolationArrayField(
    existing?.whitelist,
    policy.whitelist,
    override,
  );
  if (whitelist !== undefined) {
    merged.whitelist = whitelist as IsolationPolicy["whitelist"];
  }

  if (merged.deny !== undefined && merged.only !== undefined) {
    isolateConflictError.throw({ policyResourceId });
  }

  if (policy.exports !== undefined) {
    if (policy.exports === "none") {
      merged.exports = "none";
    } else if (Array.isArray(policy.exports)) {
      if (
        override ||
        existingExports === undefined ||
        existingExports === "none"
      ) {
        merged.exports = [...policy.exports];
      } else if (Array.isArray(existingExports)) {
        merged.exports = [...existingExports, ...policy.exports];
      } else {
        merged.exports = [...policy.exports];
      }
    } else {
      merged.exports = policy.exports;
    }
  } else if (existingExports !== undefined) {
    merged.exports = existingExports;
  }

  return merged;
}

export function assertIsolationConflict(
  policyResourceId: string,
  existing: IsolationPolicy | undefined,
  policy: IsolationPolicy,
  options?: { override?: boolean },
): void {
  const existingDenyPresent = existing?.deny !== undefined;
  const existingOnlyPresent = existing?.only !== undefined;
  const nextDenyPresent =
    options?.override === true
      ? policy.deny !== undefined
      : existingDenyPresent || policy.deny !== undefined;
  const nextOnlyPresent =
    options?.override === true
      ? policy.only !== undefined
      : existingOnlyPresent || policy.only !== undefined;

  if (nextDenyPresent && nextOnlyPresent) {
    isolateConflictError.throw({ policyResourceId });
  }
}

export function createIsolatePolicyDeclaration<TConfig>(
  policy: IsolationPolicyInput<TConfig>,
  options?: { override?: boolean },
): IsolationPolicyDeclaration<TConfig> {
  return {
    policy,
    ...(options ? { options: { override: options.override } } : {}),
  };
}

export function mergeIsolatePolicyDeclarations<TConfig>(
  existing: ReadonlyArray<IsolationPolicyDeclaration<TConfig>> | undefined,
  incoming: IsolationPolicyInput<TConfig>,
  options?: { override?: boolean },
): ReadonlyArray<IsolationPolicyDeclaration<TConfig>> {
  return Object.freeze([
    ...(existing ?? []),
    createIsolatePolicyDeclaration(incoming, options),
  ]);
}

export function resolveIsolatePolicyDeclarations<TConfig>(
  declarations: ReadonlyArray<IsolationPolicyDeclaration<TConfig>> | undefined,
  config: TConfig,
  policyResourceId?: string,
): IsolationPolicy | undefined {
  if (!declarations || declarations.length === 0) {
    return undefined;
  }

  if (declarations.length === 1) {
    const declaration = declarations[0];
    return typeof declaration.policy === "function"
      ? declaration.policy(config)
      : declaration.policy;
  }

  let merged: IsolationPolicy | undefined;

  for (const declaration of declarations) {
    const policy =
      typeof declaration.policy === "function"
        ? declaration.policy(config)
        : declaration.policy;
    merged = mergeIsolationPolicy(
      merged,
      policy,
      declaration.options,
      policyResourceId,
    );
  }

  return merged;
}

export function createDisplayIsolatePolicy<TConfig>(
  declarations: ReadonlyArray<IsolationPolicyDeclaration<TConfig>> | undefined,
  policyResourceId?: string,
): IsolationPolicyInput<TConfig> | undefined {
  if (!declarations || declarations.length === 0) {
    return undefined;
  }

  if (declarations.length === 1) {
    return declarations[0].policy;
  }

  const hasDynamic = declarations.some(
    (declaration) => typeof declaration.policy === "function",
  );

  if (!hasDynamic) {
    let merged: IsolationPolicy | undefined;

    for (const declaration of declarations) {
      merged = mergeIsolationPolicy(
        merged,
        declaration.policy as IsolationPolicy,
        declaration.options,
        policyResourceId,
      );
    }

    return merged;
  }

  return (config: TConfig) =>
    resolveIsolatePolicyDeclarations(
      declarations,
      config,
      policyResourceId,
    ) as IsolationPolicy;
}

export function mergeLegacyExportsIntoIsolationInput<TConfig>(
  resourceId: string,
  legacyExports: Array<IsolationExportsTarget> | undefined,
  isolate: IsolationPolicyInput<TConfig> | undefined,
): IsolationPolicyInput<TConfig> | undefined {
  if (legacyExports === undefined) {
    return isolate;
  }

  if (!isolate) {
    return { exports: legacyExports };
  }

  if (typeof isolate === "function") {
    return (config: TConfig) => {
      const resolved = isolate(config);
      if (resolved.exports !== undefined) {
        isolateExportsConflictError.throw({ resourceId });
      }

      return { ...resolved, exports: legacyExports };
    };
  }

  if (isolate.exports !== undefined) {
    isolateExportsConflictError.throw({ resourceId });
  }

  return { ...isolate, exports: legacyExports };
}

export function getStoredIsolationPolicy<TConfig>(resource: {
  isolate?: IsolationPolicyInput<TConfig>;
}): IsolationPolicy | undefined {
  return resource.isolate as IsolationPolicy | undefined;
}

export function getDeprecatedExportsFromIsolation(
  isolate: IsolationPolicyInput<any> | undefined,
): Array<IsolationExportsTarget> | undefined {
  if (!isolate || typeof isolate === "function") {
    return undefined;
  }

  if (isolate.exports === "none") {
    return [];
  }

  return Array.isArray(isolate.exports) ? [...isolate.exports] : undefined;
}
