import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

// Duplicate registration
export const duplicateRegistrationError = error<
  { type: string; id: string } & DefaultErrorType
>("duplicateRegistration")
  .format(
    ({ type, id }) =>
      `${type} "${id.toString()}" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.`,
  )
  .remediation(
    ({ type }) =>
      `Ensure each ${type} has a unique id. If you need the same definition in multiple places, use .fork() to create a copy with a new id.`,
  )
  .build();

// Dependency not found
export const dependencyNotFoundError = error<
  { key: string } & DefaultErrorType
>("dependencyNotFound")
  .format(
    ({ key }) =>
      `Dependency ${key.toString()} not found. Did you forget to register it through a resource?`,
  )
  .remediation(
    ({ key }) =>
      `Register the dependency "${key.toString()}" in a parent resource using .register([${key.toString()}]). If the dependency is optional, use .optional() when declaring it.`,
  )
  .build();

// Override target not registered
export const overrideTargetNotRegisteredError = error<
  {
    targetId: string;
    targetType:
      | "Task"
      | "Resource"
      | "Task middleware"
      | "Resource middleware"
      | "Hook";
    sources?: string[];
  } & DefaultErrorType
>("overrideTargetNotRegistered")
  .format(({ targetId, targetType, sources }) => {
    const sourceDetails =
      sources && sources.length > 0
        ? ` Requested from override(s) declared in: ${sources.join(", ")}.`
        : "";

    return `Override target ${targetType} "${targetId}" is not registered, so it cannot be overridden.${sourceDetails}`;
  })
  .remediation(({ targetId, targetType }) => {
    const replacementPath = `Overrides replace existing ids. First register ${targetType.toLowerCase()} "${targetId}" in the graph via .register([...]), then apply .overrides([...]) from a parent resource.`;
    const directRegistrationPath = `If you already control composition, you can register the overridden definition directly (without .overrides([...])) as long as only one definition for that id is registered.`;
    const separateInstanceHint =
      targetType === "Resource"
        ? ` If you intended a separate resource instance (not a replacement), use a different id. Leaf resources can use .fork("new-id"), while non-leaf resources should be composed explicitly.`
        : ` If you intended a separate component (not a replacement), keep a different id and register it directly.`;

    return `${replacementPath} ${directRegistrationPath}${separateInstanceHint}`;
  })
  .build();

export const overrideDuplicateTargetError = error<
  {
    targetId: string;
    sources: string[];
  } & DefaultErrorType
>("overrideDuplicateTarget")
  .format(
    ({ targetId, sources }) =>
      `Override target "${targetId}" is declared more than once. Conflicting override sources: ${sources.join(", ")}.`,
  )
  .remediation(
    ({ targetId }) =>
      `Keep a single override for "${targetId}" within the same runtime graph outside test mode. In test mode, duplicate override targets are allowed and the outermost declaring resource wins. If you need environment variants, select one override at composition time.`,
  )
  .build();

export const overrideOutOfScopeError = error<
  {
    sourceId: string;
    targetId: string;
    targetType:
      | "Task"
      | "Resource"
      | "Task middleware"
      | "Resource middleware"
      | "Hook";
    ownerResourceId?: string;
  } & DefaultErrorType
>("overrideOutOfScope")
  .format(({ sourceId, targetId, targetType, ownerResourceId }) => {
    const ownerDetails = ownerResourceId
      ? ` It belongs to resource "${ownerResourceId}".`
      : "";

    return `Resource "${sourceId}" cannot override ${targetType} "${targetId}" because it is outside that resource's registration subtree.${ownerDetails}`;
  })
  .remediation(
    ({ sourceId }) =>
      `Declare the override from a parent resource that owns the target subtree, or move the target registration under "${sourceId}" if that resource should control it. Overrides are only allowed downstream within the declaring resource's subtree.`,
  )
  .build();

export const overrideDefinitionRequiredError = error<
  {
    sourceId: string;
    receivedId?: string;
  } & DefaultErrorType
>("overrideDefinitionRequired")
  .format(
    ({ sourceId, receivedId }) =>
      `Resource "${sourceId}" declares an invalid override${
        receivedId ? ` ("${receivedId}")` : ""
      }. .overrides([...]) accepts only definitions produced by r.override(...) / defineOverride(...).`,
  )
  .remediation(
    ({ receivedId }) =>
      `Wrap the base definition with r.override(base, fn) or defineOverride(base, fn)${
        receivedId ? ` for "${receivedId}"` : ""
      } before passing it to .overrides([...]).`,
  )
  .build();

// Unknown item type
export const unknownItemTypeError = error<{ item: unknown } & DefaultErrorType>(
  "unknownItemType",
)
  .format(
    ({ item }) =>
      `Unknown item type: ${String(
        item,
      )}. Please ensure you are not using different versions of '@bluelibs/runner'`,
  )
  .remediation(
    "Check that all packages depend on the same version of '@bluelibs/runner'. Run 'npm ls @bluelibs/runner' to detect duplicates.",
  )
  .build();

// Event not found
export const eventNotFoundError = error<{ id: string } & DefaultErrorType>(
  "eventNotFound",
)
  .format(
    ({ id }) =>
      `Event "${id.toString()}" not found. Did you forget to register it?`,
  )
  .remediation(
    ({ id }) =>
      `Add the event "${id.toString()}" to a parent resource via .register([yourEvent]). Ensure the event definition is built with r.event("${id.toString()}").build().`,
  )
  .build();

// Resource not found
export const resourceNotFoundError = error<{ id: string } & DefaultErrorType>(
  "resourceNotFound",
)
  .format(
    ({ id }) =>
      `Resource "${id.toString()}" not found. Did you forget to register it or are you using the correct id?`,
  )
  .remediation(
    ({ id }) =>
      `Register the resource "${id.toString()}" in a parent resource via .register([yourResource]). Verify the id string matches exactly (ids are case-sensitive).`,
  )
  .build();

// Middleware not registered
export const middlewareNotRegisteredError = error<
  {
    type: "task" | "resource";
    source: string;
    middlewareId: string;
  } & DefaultErrorType
>("middlewareNotRegistered")
  .format(
    ({ type, source, middlewareId }) =>
      `Middleware inside ${type} "${source}" depends on "${middlewareId}" but it's not registered. Did you forget to register it?`,
  )
  .remediation(
    ({ middlewareId }) =>
      `Register the middleware "${middlewareId}" alongside its consumer in a parent resource via .register([yourMiddleware]).`,
  )
  .build();

// Tag not found
export const tagNotFoundError = error<{ id: string } & DefaultErrorType>(
  "tagNotFound",
)
  .format(
    ({ id }) =>
      `Tag "${id}" not registered. Did you forget to register it inside a resource?`,
  )
  .remediation(
    ({ id }) =>
      `Register the tag "${id}" in a parent resource via .register([yourTag]). Tags must be registered before they can be queried.`,
  )
  .build();

export const duplicateTagIdOnDefinitionError = error<
  {
    definitionType: string;
    definitionId: string;
    tagId: string;
  } & DefaultErrorType
>("duplicateTagIdOnDefinition")
  .format(
    ({ definitionType, definitionId, tagId }) =>
      `${definitionType} "${definitionId}" declares duplicate tag "${tagId}". A definition can only include a tag id once.`,
  )
  .remediation(
    ({ definitionId, tagId }) =>
      `Remove the duplicate "${tagId}" tag from "${definitionId}", or fork the definition when you need separate tagged variants.`,
  )
  .build();

export const tagSelfDependencyError = error<
  {
    definitionType: string;
    definitionId: string;
    tagId: string;
  } & DefaultErrorType
>("tagSelfDependency")
  .format(
    ({ definitionType, definitionId, tagId }) =>
      `${definitionType} "${definitionId}" cannot depend on tag "${tagId}" because it already carries the same tag.`,
  )
  .remediation(
    ({ definitionId, tagId }) =>
      `Remove "${tagId}" from "${definitionId}" tags, or stop declaring it as a dependency. Self tag dependencies are forbidden to prevent ambiguous graph coupling.`,
  )
  .build();

export const tagTargetNotAllowedError = error<
  {
    definitionType: string;
    definitionId: string;
    tagId: string;
    attemptedTarget: string;
    allowedTargets: string[];
  } & DefaultErrorType
>("tagTargetNotAllowed")
  .format(
    ({
      definitionType,
      definitionId,
      tagId,
      attemptedTarget,
      allowedTargets,
    }) =>
      `${definitionType} "${definitionId}" cannot use tag "${tagId}" on "${attemptedTarget}". Allowed targets: ${allowedTargets.join(", ")}.`,
  )
  .remediation(
    ({ tagId, attemptedTarget }) =>
      `Remove "${tagId}" from the ${attemptedTarget} definition, or expand the tag with .for([...]) to include "${attemptedTarget}".`,
  )
  .build();
