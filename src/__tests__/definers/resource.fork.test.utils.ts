import type { RegisterableItems } from "../../defs";

export function assertRegisterArray(
  register: RegisterableItems[] | ((config: void) => RegisterableItems[]),
): asserts register is RegisterableItems[] {
  if (!Array.isArray(register)) {
    throw new Error("Expected resource.register to be an array");
  }
}

export function assertRegisterFn(
  register: RegisterableItems[] | ((config: void) => RegisterableItems[]),
): asserts register is (config: void) => RegisterableItems[] {
  if (typeof register !== "function") {
    throw new Error("Expected resource.register to be a function");
  }
}
