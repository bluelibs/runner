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

export const invalidPayloadError = (message: string): never =>
  serializerInvalidPayloadError.throw({ message });

export const validationError = (message: string): never =>
  serializerValidationError.throw({ message });

export const depthExceededError = (maxDepth: number): never =>
  serializerDepthExceededError.throw({ maxDepth });

export const referenceResolutionError = (message: string): never =>
  serializerReferenceResolutionError.throw({ message });

export const unsupportedFeatureError = (message: string): never =>
  serializerUnsupportedFeatureError.throw({ message });

export const typeRegistryError = (message: string): never =>
  serializerTypeRegistryError.throw({ message });

export const symbolPolicyError = (message: SymbolPolicyErrorMessage): never =>
  serializerSymbolPolicyError.throw({ message });
