import type {
  DependencyMapType,
  IsolationChannel,
  IsolationSubtreeFilter,
} from "../../defs";

export type CompiledChannelSets = {
  matchAll: boolean;
  ids: Set<string>;
  tagIds: Set<string>;
  subtreeFilters: IsolationSubtreeFilter[];
};

export type CompiledIsolationPolicy = {
  deny: Record<IsolationChannel, CompiledChannelSets>;
  onlyMode: boolean;
  only: Record<IsolationChannel, CompiledChannelSets>;
  whitelist: CompiledIsolationWhitelistEntry[];
};

export type CompiledIsolationWhitelistEntry = {
  consumers: Record<IsolationChannel, CompiledChannelSets>;
  targets: Record<IsolationChannel, CompiledChannelSets>;
};

export type AccessViolation =
  | {
      kind: "visibility";
      targetOwnerResourceId: string;
      exportedIds: string[];
    }
  | {
      kind: "isolate";
      policyResourceId: string;
      matchedRuleType: "id" | "tag" | "only" | "subtree" | "wildcard";
      matchedRuleId: string;
      channel: IsolationChannel;
    };

export type DependencyValidationEntry = {
  consumerId: string;
  consumerType: string;
  dependencies: DependencyMapType | undefined;
};

export type TagValidationEntry = {
  consumerId: string;
  consumerType: string;
  tags: unknown;
};

export type MiddlewareVisibilityEntry = {
  consumerId: string;
  consumerType: string;
  targetType: string;
  targetIds: string[];
};
