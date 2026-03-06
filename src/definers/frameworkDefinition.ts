import { defineAsyncContext } from "./defineAsyncContext";
import { defineEvent } from "./defineEvent";
import { defineHook } from "./defineHook";
import { defineResource } from "./defineResource";
import { defineTag } from "./defineTag";
import { defineTaskMiddleware } from "./defineTaskMiddleware";
import { defineResourceMiddleware } from "./defineResourceMiddleware";
import { defineError } from "./defineError";
import { markFrameworkDefinition } from "./markFrameworkDefinition";

export const defineFrameworkResource: typeof defineResource = (definition) =>
  defineResource(markFrameworkDefinition(definition));

export const defineFrameworkEvent: typeof defineEvent = (definition) =>
  defineEvent(markFrameworkDefinition(definition));

export const defineFrameworkHook: typeof defineHook = (definition) =>
  defineHook(markFrameworkDefinition(definition));

export const defineFrameworkTag: typeof defineTag = (definition) =>
  defineTag(markFrameworkDefinition(definition));

export const defineFrameworkTaskMiddleware: typeof defineTaskMiddleware = (
  definition,
) => defineTaskMiddleware(markFrameworkDefinition(definition));

export const defineFrameworkResourceMiddleware: typeof defineResourceMiddleware =
  (definition) => defineResourceMiddleware(markFrameworkDefinition(definition));

export const defineFrameworkAsyncContext: typeof defineAsyncContext = (
  definition,
) => defineAsyncContext(markFrameworkDefinition(definition));

export const defineFrameworkError: typeof defineError = (
  definition,
  filePath,
) => defineError(markFrameworkDefinition(definition), filePath);
