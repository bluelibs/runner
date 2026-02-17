import type { RegisterableItems } from "../../defs";
import { createMessageError } from "../../errors";

export function assertRegisterArray(
  register: RegisterableItems[] | ((config: void) => RegisterableItems[]),
): asserts register is RegisterableItems[] {
  if (!Array.isArray(register)) {
    throw createMessageError("Expected resource.register to be an array");
  }
}

export function assertRegisterFn(
  register: RegisterableItems[] | ((config: void) => RegisterableItems[]),
): asserts register is (config: void) => RegisterableItems[] {
  if (typeof register !== "function") {
    throw createMessageError("Expected resource.register to be a function");
  }
}
