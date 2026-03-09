import type {
  IsolationWhitelistEntry,
  IsolationChannel,
  IsolationPolicy,
} from "../../defs";
import {
  classifyIsolationEntry,
  classifyScopeTarget,
} from "../../tools/classifyIsolationEntry";
import type { ClassifiedScopeTarget } from "../../tools/classifyIsolationEntry";
import type {
  CompiledChannelSets,
  CompiledIsolationWhitelistEntry,
  CompiledIsolationPolicy,
} from "./contracts";

const ALL_CHANNELS: readonly IsolationChannel[] = [
  "dependencies",
  "listening",
  "tagging",
  "middleware",
] as const;

function emptyChannelSets(): CompiledChannelSets {
  return { ids: new Set(), tagIds: new Set(), subtreeFilters: [] };
}

function emptyChannelRecord(): Record<IsolationChannel, CompiledChannelSets> {
  return {
    dependencies: emptyChannelSets(),
    listening: emptyChannelSets(),
    tagging: emptyChannelSets(),
    middleware: emptyChannelSets(),
  };
}

function forEachEnabledChannel(
  channels: Readonly<Record<IsolationChannel, boolean>>,
  run: (channel: IsolationChannel) => void,
): void {
  for (const channel of ALL_CHANNELS) {
    if (!channels[channel]) {
      continue;
    }
    run(channel);
  }
}

function addClassifiedTarget(
  classified: ClassifiedScopeTarget,
  channels: Readonly<Record<IsolationChannel, boolean>>,
  channelRecord: Record<IsolationChannel, CompiledChannelSets>,
): void {
  switch (classified.kind) {
    case "subtreeFilter":
      forEachEnabledChannel(channels, (channel) => {
        channelRecord[channel].subtreeFilters.push(classified.filter);
      });
      break;
    case "tag":
      forEachEnabledChannel(channels, (channel) => {
        channelRecord[channel].tagIds.add(classified.id);
      });
      break;
    case "string":
      forEachEnabledChannel(channels, (channel) => {
        channelRecord[channel].ids.add(classified.value);
      });
      break;
    case "definition":
      forEachEnabledChannel(channels, (channel) => {
        channelRecord[channel].ids.add(classified.id);
      });
      break;
    case "unknown":
      break;
  }
}

function compileIsolationEntry(
  entry: unknown,
  channelRecord: Record<IsolationChannel, CompiledChannelSets>,
): void {
  const classified = classifyIsolationEntry(entry);
  const allChannelsEnabled = {
    dependencies: true,
    listening: true,
    tagging: true,
    middleware: true,
  } as const;

  if (classified.kind === "scope") {
    for (const target of classified.scope.targets) {
      addClassifiedTarget(
        classifyScopeTarget(target),
        classified.scope.channels,
        channelRecord,
      );
    }
    return;
  }

  addClassifiedTarget(classified, allChannelsEnabled, channelRecord);
}

function compileWhitelistEntry(
  entry: IsolationWhitelistEntry,
): CompiledIsolationWhitelistEntry {
  const consumers = emptyChannelRecord();
  const targets = emptyChannelRecord();
  const channels = {
    dependencies: entry.channels?.dependencies ?? true,
    listening: entry.channels?.listening ?? true,
    tagging: entry.channels?.tagging ?? true,
    middleware: entry.channels?.middleware ?? true,
  } as const;

  for (const consumer of entry.for) {
    addClassifiedTarget(classifyScopeTarget(consumer), channels, consumers);
  }

  for (const target of entry.targets) {
    addClassifiedTarget(classifyScopeTarget(target), channels, targets);
  }

  return { consumers, targets };
}

export function compileIsolationPolicy(
  policy?: IsolationPolicy,
): CompiledIsolationPolicy | undefined {
  const hasDeny = Array.isArray(policy?.deny) && policy.deny.length > 0;
  const onlyPresent = policy !== undefined && Array.isArray(policy.only);
  const hasWhitelist =
    Array.isArray(policy?.whitelist) && policy.whitelist.length > 0;

  if (!hasDeny && !onlyPresent && !hasWhitelist) {
    return undefined;
  }

  const deny = emptyChannelRecord();
  const only = emptyChannelRecord();
  const whitelist = hasWhitelist
    ? policy!.whitelist!.map(compileWhitelistEntry)
    : [];

  if (hasDeny) {
    for (const entry of policy!.deny!) {
      compileIsolationEntry(entry, deny);
    }
  }

  if (onlyPresent) {
    for (const entry of policy!.only!) {
      compileIsolationEntry(entry, only);
    }
  }

  return {
    deny,
    onlyMode: onlyPresent,
    only,
    whitelist,
  };
}
