import { error } from "../definers/builders/error";
import type { DefaultErrorType } from "../types/error";

/**
 * Generic fallback helper. Use only when no stable typed contract is possible.
 */
export const genericError = error<{ message: string } & DefaultErrorType>(
  "genericError",
)
  .format(({ message }) => message)
  .build();
