import { error } from "../../definers/builders/error";

/** Reports invalid local shell configuration or terminal usage. */
export const shellError = error<{ message: string }>("shell-error")
  .format(({ message }) => message)
  .build();
