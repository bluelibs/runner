import {
  serializerDepthExceededError,
  serializerInvalidPayloadError,
  serializerReferenceResolutionError,
  serializerSymbolPolicyError,
  serializerTypeRegistryError,
  serializerUnsupportedFeatureError,
  serializerValidationError,
} from "../errors";
import { SymbolPolicyErrorMessage } from "./types";

const toError = <T>(thrower: (data: T) => never, data: T): Error => {
  try {
    thrower(data);
  } catch (error: unknown) {
    return error as Error;
  }
};

export const invalidPayloadError = (message: string): Error =>
  toError(
    serializerInvalidPayloadError.throw.bind(serializerInvalidPayloadError),
    {
      message,
    },
  );

export const validationError = (message: string): Error =>
  toError(serializerValidationError.throw.bind(serializerValidationError), {
    message,
  });

export const depthExceededError = (maxDepth: number): Error =>
  toError(
    serializerDepthExceededError.throw.bind(serializerDepthExceededError),
    {
      maxDepth,
    },
  );

export const referenceResolutionError = (message: string): Error =>
  toError(
    serializerReferenceResolutionError.throw.bind(
      serializerReferenceResolutionError,
    ),
    { message },
  );

export const unsupportedFeatureError = (message: string): Error =>
  toError(
    serializerUnsupportedFeatureError.throw.bind(
      serializerUnsupportedFeatureError,
    ),
    { message },
  );

export const typeRegistryError = (message: string): Error =>
  toError(serializerTypeRegistryError.throw.bind(serializerTypeRegistryError), {
    message,
  });

export const symbolPolicyError = (message: SymbolPolicyErrorMessage): Error =>
  toError(serializerSymbolPolicyError.throw.bind(serializerSymbolPolicyError), {
    message,
  });
