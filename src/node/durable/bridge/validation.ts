import { check, Match } from "../../../tools/check";
import { isResource, isEvent } from "../../../definers/tools";
import { retentionDelay } from "../core/retention";
import type { DurableEventBridgeConfig, DurableEventConfig } from "./types";

const resource = Match.Where(isResource);
const retention = Match.Optional(Object);
const version = Match.Optional(Match.NonEmptyString);

/** Validates event policy before runtime routing is compiled. */
export function parseEventPolicy(input: unknown): DurableEventConfig {
  check(input, {
    enabled: Match.Optional(Boolean),
    durable: Match.Optional(resource),
    compensation: Match.Optional("required"),
    retention,
    version,
  });
  const config = input as DurableEventConfig;
  retentionDelay(config.retention);
  return config;
}

/** Validates the bridge's selection policy at the configuration boundary. */
export function parseBridgeConfig(input: unknown): DurableEventBridgeConfig {
  check(input, {
    defaultDurable: Match.Optional(resource),
    applyTo: Match.Optional(
      Match.OneOf("all", Function, Match.ArrayOf(Match.Where(isEvent))),
    ),
    retention,
  });
  const config = input as DurableEventBridgeConfig;
  retentionDelay(config.retention);
  return config;
}
