import { error } from "../definers/builders/error";
import type { DefaultErrorType } from "../types/error";

// Generic fallback helper. Use only when no stable typed contract is possible.
const messageError = error<{ message: string } & DefaultErrorType>("Error")
  .format(({ message }) => message)
  .build();

export const createMessageError = (message?: unknown): never =>
  messageError.throw({
    message: message === undefined ? "" : String(message),
  });
