import {
  getRegisteredCheckRuntime,
  registerCheckRuntime,
  resetCheckRuntimeRegistry,
} from "../../tools/check/runtime";
import { defineError } from "../../definers/defineError";

describe("check runtime registry", () => {
  afterEach(() => {
    resetCheckRuntimeRegistry();
  });

  it("throws until the runtime is fully registered", () => {
    resetCheckRuntimeRegistry();
    expect(() => getRegisteredCheckRuntime()).toThrow(
      /check runtime is not registered/i,
    );

    registerCheckRuntime({
      Match: {} as never,
    });

    expect(() => getRegisteredCheckRuntime()).toThrow(
      /check runtime is not registered/i,
    );
  });

  it("returns the registered runtime once both hooks are present", () => {
    const match = {} as never;
    const hasClassSchemaMetadata = (() => true) as never;

    registerCheckRuntime({
      Match: match,
      hasClassSchemaMetadata,
    });

    expect(getRegisteredCheckRuntime()).toEqual({
      Match: match,
      hasClassSchemaMetadata,
    });
  });

  it("does not require the check runtime just to define a raw-pattern error", () => {
    resetCheckRuntimeRegistry();

    expect(() =>
      defineError({
        id: "check-runtime-lazy-error",
        dataSchema: { reason: String },
        format: ({ reason }) => reason,
      }),
    ).not.toThrow();
  });
});
