import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";
import type { IsolationChannel } from "../../tools/scope";

export const isolateConflictError = error<
  {
    policyResourceId: string;
  } & DefaultErrorType
>("runner.errors.isolationConflict")
  .format(
    ({ policyResourceId }) =>
      `Resource "${policyResourceId}" declares both "deny" and "only" in its isolate policy.`,
  )
  .remediation(
    ({ policyResourceId }) =>
      `An isolate policy can have either "deny" or "only", but not both. Review "${policyResourceId}" and remove one of them.`,
  )
  .build();

export const isolateInvalidEntryError = error<
  {
    policyResourceId: string;
    entry: unknown;
  } & DefaultErrorType
>("runner.errors.isolationInvalidEntry")
  .format(
    ({ policyResourceId }) =>
      `Resource "${policyResourceId}" declares an invalid isolate policy entry.`,
  )
  .remediation(
    ({ policyResourceId }) =>
      `Use .isolate({ deny: [...] }) or .isolate({ only: [...] }) with Runner definitions, subtreeOf() filters, or scope() entries. String targets are not supported. Review "${policyResourceId}" and fix malformed entries.`,
  )
  .build();

export const isolateUnknownTargetError = error<
  {
    policyResourceId: string;
    targetId: string;
  } & DefaultErrorType
>("runner.errors.isolationUnknownTarget")
  .format(
    ({ policyResourceId, targetId }) =>
      `Resource "${policyResourceId}" references unknown target "${targetId}" in its isolate policy.`,
  )
  .remediation(
    ({ targetId }) =>
      `Register "${targetId}" in the same runtime graph and pass the definition reference (or subtreeOf filter) instead of raw ids.`,
  )
  .build();

export const isolateExportsConflictError = error<
  {
    resourceId: string;
  } & DefaultErrorType
>("runner.errors.isolateExportsConflict")
  .format(
    ({ resourceId }) =>
      `Resource "${resourceId}" declares exports in both .exports(...) and .isolate({ exports: ... }).`,
  )
  .remediation(
    ({ resourceId }) =>
      `Remove the legacy "exports" declaration from "${resourceId}" and keep exports only under .isolate({ exports: ... }).`,
  )
  .build();

export const isolateInvalidExportsError = error<
  {
    policyResourceId: string;
    entry: unknown;
  } & DefaultErrorType
>("runner.errors.isolateInvalidExports")
  .format(
    ({ policyResourceId }) =>
      `Resource "${policyResourceId}" declares an invalid isolate exports value.`,
  )
  .remediation(
    ({ policyResourceId }) =>
      `Use .isolate({ exports: [...] }) or .isolate({ exports: "none" }) on "${policyResourceId}". Export entries must be explicit Runner definition or resource references.`,
  )
  .build();

export const isolateExportsUnknownTargetError = error<
  {
    policyResourceId: string;
    targetId: string;
  } & DefaultErrorType
>("runner.errors.isolateExportsUnknownTarget")
  .format(
    ({ policyResourceId, targetId }) =>
      `Resource "${policyResourceId}" exports unknown target "${targetId}" in its isolate policy.`,
  )
  .remediation(
    ({ targetId }) =>
      `Register "${targetId}" in the same runtime graph and pass the definition reference (or subtreeOf filter) instead of raw ids.`,
  )
  .build();

export const isolateViolationError = error<
  {
    targetId: string;
    targetType: string;
    consumerId: string;
    consumerType: string;
    policyResourceId: string;
    matchedRuleType: "id" | "tag" | "only" | "subtree";
    matchedRuleId: string;
    channel: IsolationChannel;
  } & DefaultErrorType
>("runner.errors.isolationViolation")
  .format(
    ({
      targetId,
      targetType,
      consumerId,
      consumerType,
      policyResourceId,
      matchedRuleType,
      channel,
    }) =>
      matchedRuleType === "only"
        ? `${targetType} "${targetId}" is not allowed by isolate "only" rule on resource "${policyResourceId}" (channel: ${channel}) and cannot be referenced by ${consumerType} "${consumerId}".`
        : `${targetType} "${targetId}" is denied by isolate policy on resource "${policyResourceId}" (channel: ${channel}) and cannot be referenced by ${consumerType} "${consumerId}".`,
  )
  .remediation(
    ({ policyResourceId, matchedRuleType, matchedRuleId, channel }) => {
      if (matchedRuleType === "only") {
        return `Target is not in the "only" list for "channel: ${channel}". Add it to the "only" list on "${policyResourceId}", or move the consumer outside that resource subtree.`;
      }
      if (matchedRuleType === "subtree") {
        return `Denied by subtreeOf("${matchedRuleId}") filter on "${policyResourceId}" (channel: ${channel}). Remove or narrow the subtreeOf() filter, or move the consumer outside that resource subtree.`;
      }
      const rule =
        matchedRuleType === "tag"
          ? `Denied tag rule "${matchedRuleId}".`
          : `Denied id rule "${matchedRuleId}".`;
      return `${rule} Channel: "${channel}". Remove or narrow the deny rule on "${policyResourceId}", or move the consumer outside that resource subtree.`;
    },
  )
  .build();

export const subtreeValidationFailedError = error<
  {
    violations: Array<{
      ownerResourceId: string;
      targetType:
        | "task"
        | "resource"
        | "hook"
        | "task-middleware"
        | "resource-middleware"
        | "event"
        | "tag";
      targetId: string;
      code: string;
      message: string;
    }>;
  } & DefaultErrorType
>("runner.errors.subtreeValidationFailed")
  .format(({ violations }) => {
    const lines = violations.map(
      (violation) =>
        `  - owner=${violation.ownerResourceId} target=${violation.targetType}:${violation.targetId} code=${violation.code} message=${violation.message}`,
    );

    return `Subtree policy validation failed with ${violations.length} violation(s):\n${lines.join("\n")}`;
  })
  .remediation(
    "Fix subtree validators/middleware policy declarations in your resource tree before bootstrapping the runtime.",
  )
  .build();

// Visibility violation — item is internal to a resource that declared exports
export const visibilityViolationError = error<
  {
    targetId: string;
    targetType: string;
    ownerResourceId: string;
    consumerId: string;
    consumerType: string;
    exportedIds: string[];
  } & DefaultErrorType
>("runner.errors.visibilityViolation")
  .format(
    ({ targetId, targetType, ownerResourceId, consumerId, consumerType }) =>
      `${targetType} "${targetId}" is internal to resource "${ownerResourceId}" and cannot be referenced by ${consumerType} "${consumerId}".`,
  )
  .remediation(({ targetId, ownerResourceId, exportedIds }) => {
    const exported =
      exportedIds.length > 0
        ? `Resource "${ownerResourceId}" exports: [${exportedIds.join(", ")}].`
        : `Resource "${ownerResourceId}" has no exports.`;
    return `${exported} Either add "${targetId}" to ${ownerResourceId}'s .isolate({ exports: [...] }), or restructure to use an exported item instead.`;
  })
  .build();
