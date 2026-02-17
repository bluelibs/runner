import { invalidPayloadError, unsupportedFeatureError } from "./errors";
import type { TypeDefinition } from "./types";

const hasOwn = Object.prototype.hasOwnProperty;
const errorReservedPropertyNames = new Set([
  "name",
  "message",
  "stack",
  "cause",
]);
const errorMethodShadowingPropertyNames = new Set([
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "toJSON",
]);

interface RuntimeUrlConstructor {
  new (url: string, base?: string | URL): URL;
}

interface RuntimeUrlSearchParamsConstructor {
  new (
    init?:
      | string
      | readonly (readonly [string, string])[]
      | Record<string, string>
      | URLSearchParams,
  ): URLSearchParams;
}

interface ErrorWithCause extends Error {
  cause?: unknown;
}

interface SerializedErrorPayload {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  customFields: Record<string, unknown>;
}

interface ParsedErrorPayload {
  name: string;
  message: string;
  stack?: string;
  hasCause: boolean;
  cause: unknown;
  customFields: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUnsafePropertyName = (propertyName: string): boolean =>
  propertyName === "__proto__" ||
  propertyName === "constructor" ||
  propertyName === "prototype";

const shouldBlockErrorCustomField = (propertyName: string): boolean =>
  isUnsafePropertyName(propertyName) ||
  errorReservedPropertyNames.has(propertyName) ||
  errorMethodShadowingPropertyNames.has(propertyName);

const collectErrorCustomFields = (error: Error): Record<string, unknown> => {
  const customFields: Record<string, unknown> = {};
  for (const propertyName of Object.getOwnPropertyNames(error)) {
    if (shouldBlockErrorCustomField(propertyName)) {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(error, propertyName);
    if (!descriptor || !("value" in descriptor)) {
      continue;
    }

    customFields[propertyName] = descriptor.value;
  }
  return customFields;
};

const assertSerializedErrorPayload = (value: unknown): ParsedErrorPayload => {
  if (!isRecord(value)) {
    throw invalidPayloadError("Invalid Error payload");
  }

  const { name, message, stack, customFields } = value;
  if (typeof name !== "string" || typeof message !== "string") {
    throw invalidPayloadError("Invalid Error payload");
  }
  if (stack !== undefined && typeof stack !== "string") {
    throw invalidPayloadError("Invalid Error payload");
  }
  if (customFields !== undefined && !isRecord(customFields)) {
    throw invalidPayloadError("Invalid Error payload");
  }

  const normalizedCustomFields: Record<string, unknown> = {};
  const customFieldEntries = Object.entries(customFields ?? {});
  for (const [propertyName, propertyValue] of customFieldEntries) {
    if (shouldBlockErrorCustomField(propertyName)) {
      continue;
    }
    normalizedCustomFields[propertyName] = propertyValue;
  }

  return {
    name,
    message,
    stack,
    hasCause: hasOwn.call(value, "cause"),
    cause: value.cause,
    customFields: normalizedCustomFields,
  };
};

const getUrlConstructor = (): RuntimeUrlConstructor | null => {
  const value = (globalThis as Record<string, unknown>).URL;
  if (typeof value !== "function") {
    return null;
  }
  return value as unknown as RuntimeUrlConstructor;
};

const getUrlSearchParamsConstructor =
  (): RuntimeUrlSearchParamsConstructor | null => {
    const value = (globalThis as Record<string, unknown>).URLSearchParams;
    if (typeof value !== "function") {
      return null;
    }
    return value as unknown as RuntimeUrlSearchParamsConstructor;
  };

export const ErrorType: TypeDefinition<Error, SerializedErrorPayload> = {
  id: "Error",
  is: (value: unknown): value is Error => value instanceof Error,
  serialize: (error: Error): SerializedErrorPayload => {
    const serializedErrorPayload: SerializedErrorPayload = {
      name: error.name,
      message: error.message,
      customFields: collectErrorCustomFields(error),
    };
    if (typeof error.stack === "string") {
      serializedErrorPayload.stack = error.stack;
    }
    if (hasOwn.call(error, "cause")) {
      serializedErrorPayload.cause = (error as ErrorWithCause).cause;
    }
    return serializedErrorPayload;
  },
  deserialize: (payload: SerializedErrorPayload): Error => {
    const { name, message, stack, hasCause, cause, customFields } =
      assertSerializedErrorPayload(payload);

    const restoredError = new Error(message);
    restoredError.name = name;
    if (stack !== undefined) {
      Object.defineProperty(restoredError, "stack", {
        value: stack,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
    if (hasCause) {
      Object.defineProperty(restoredError, "cause", {
        value: cause,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }

    for (const [propertyName, propertyValue] of Object.entries(customFields)) {
      (restoredError as unknown as Record<string, unknown>)[propertyName] =
        propertyValue;
    }

    return restoredError;
  },
};

export const URLType: TypeDefinition<URL, string> = {
  id: "URL",
  is: (value: unknown): value is URL => {
    const runtimeUrlConstructor = getUrlConstructor();
    if (!runtimeUrlConstructor) {
      return false;
    }
    return value instanceof runtimeUrlConstructor;
  },
  serialize: (value: URL): string => value.href,
  deserialize: (payload: string): URL => {
    if (typeof payload !== "string") {
      throw invalidPayloadError("Invalid URL payload");
    }
    const runtimeUrlConstructor = getUrlConstructor();
    if (!runtimeUrlConstructor) {
      throw unsupportedFeatureError("URL is not available in this runtime");
    }
    return new runtimeUrlConstructor(payload);
  },
  strategy: "value",
};

export const URLSearchParamsType: TypeDefinition<URLSearchParams, string> = {
  id: "URLSearchParams",
  is: (value: unknown): value is URLSearchParams => {
    const runtimeUrlSearchParamsConstructor = getUrlSearchParamsConstructor();
    if (!runtimeUrlSearchParamsConstructor) {
      return false;
    }
    return value instanceof runtimeUrlSearchParamsConstructor;
  },
  serialize: (value: URLSearchParams): string => value.toString(),
  deserialize: (payload: string): URLSearchParams => {
    if (typeof payload !== "string") {
      throw invalidPayloadError("Invalid URLSearchParams payload");
    }
    const runtimeUrlSearchParamsConstructor = getUrlSearchParamsConstructor();
    if (!runtimeUrlSearchParamsConstructor) {
      throw unsupportedFeatureError(
        "URLSearchParams is not available in this runtime",
      );
    }
    return new runtimeUrlSearchParamsConstructor(payload);
  },
  strategy: "value",
};

export const errorAndUrlBuiltInTypes: Array<TypeDefinition<unknown, unknown>> =
  [
    ErrorType as TypeDefinition<unknown, unknown>,
    URLType as TypeDefinition<unknown, unknown>,
    URLSearchParamsType as TypeDefinition<unknown, unknown>,
  ];
