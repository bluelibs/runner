import { identityFeatureRequiresAsyncLocalStorageError } from "../../errors";
import { globalTags } from "../../globals/globalTags";
import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";
import { validateIdentityAsyncContextSupport } from "../../models/validators";
import type { ValidatorContext } from "../../models/validators";

describe("IdentitySupportValidator", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("returns immediately when AsyncLocalStorage is available", () => {
    setPlatform(new PlatformAdapter("node"));

    const ctx = {
      registry: {
        tasks: new Map([
          [
            "task-a",
            {
              task: {
                id: "task-a",
                middleware: [
                  {
                    id: "custom.middleware.task.identityChecker",
                    config: {},
                    tags: [],
                  },
                ],
              },
            },
          ],
        ]),
        resources: new Map(),
      },
      resolveReferenceId: () => {
        throw new Error("should not inspect middleware when ALS exists");
      },
      findIdByDefinition: () => {
        throw new Error("should not resolve definitions when ALS exists");
      },
    } as unknown as ValidatorContext;

    expect(() => validateIdentityAsyncContextSupport(ctx)).not.toThrow();
  });

  it("falls back to findIdByDefinition when a middleware attachment has no canonical resolution", () => {
    setPlatform(new PlatformAdapter("browser"));

    const ctx = {
      registry: {
        tasks: new Map([
          [
            "task-a",
            {
              task: {
                id: "task-a",
                middleware: [
                  {
                    id: "custom.middleware.task.identityChecker",
                    config: {},
                  },
                ],
              },
            },
          ],
        ]),
        resources: new Map(),
      },
      resolveReferenceId: () => null,
      findIdByDefinition: (reference: unknown) =>
        typeof reference === "object" &&
        reference !== null &&
        "id" in reference &&
        typeof reference.id === "string"
          ? reference.id
          : String(reference),
    } as unknown as ValidatorContext;

    let thrown: unknown;
    try {
      validateIdentityAsyncContextSupport(ctx);
    } catch (error) {
      thrown = error;
    }

    expect(identityFeatureRequiresAsyncLocalStorageError.is(thrown)).toBe(true);
    expect(String(thrown)).toMatch(/identityChecker/i);
  });

  it("allows non-identity middleware and resources without subtree identity policies on unsupported platforms", () => {
    setPlatform(new PlatformAdapter("browser"));

    const ctx = {
      registry: {
        tasks: new Map([
          [
            "task-a",
            {
              task: {
                id: "task-a",
                middleware: [
                  {
                    id: "custom.middleware.task.audit",
                    config: {},
                    tags: [],
                  },
                ],
              },
            },
          ],
        ]),
        resources: new Map([
          [
            "resource-a",
            {
              resource: {
                id: "resource-a",
              },
            },
          ],
        ]),
      },
      resolveReferenceId: (reference: unknown) =>
        typeof reference === "object" &&
        reference !== null &&
        "id" in reference &&
        typeof reference.id === "string"
          ? reference.id
          : null,
      findIdByDefinition: (reference: unknown) =>
        typeof reference === "object" &&
        reference !== null &&
        "id" in reference &&
        typeof reference.id === "string"
          ? reference.id
          : String(reference),
    } as unknown as ValidatorContext;

    expect(() => validateIdentityAsyncContextSupport(ctx)).not.toThrow();
  });

  it("rejects subtree task middleware with explicit identityScope on unsupported platforms", () => {
    setPlatform(new PlatformAdapter("browser"));

    const ctx = {
      registry: {
        tasks: new Map(),
        resources: new Map([
          [
            "resource-a",
            {
              resource: {
                id: "resource-a",
                subtree: {
                  tasks: {
                    middleware: [
                      {
                        id: "custom.middleware.task.rateLimit",
                        config: {
                          identityScope: { tenant: true },
                        },
                        tags: [globalTags.identityScoped],
                      },
                    ],
                  },
                },
              },
            },
          ],
        ]),
      },
      resolveReferenceId: (reference: unknown) =>
        typeof reference === "object" &&
        reference !== null &&
        "id" in reference &&
        typeof reference.id === "string"
          ? reference.id
          : null,
      findIdByDefinition: (reference: unknown) =>
        typeof reference === "object" &&
        reference !== null &&
        "id" in reference &&
        typeof reference.id === "string"
          ? reference.id
          : String(reference),
    } as unknown as ValidatorContext;

    expect(() => validateIdentityAsyncContextSupport(ctx)).toThrow(
      /identityScope on task middleware/i,
    );
  });

  it("allows explicit global identityScope opt-outs on unsupported platforms", () => {
    setPlatform(new PlatformAdapter("browser"));

    const ctx = {
      registry: {
        tasks: new Map([
          [
            "task-a",
            {
              task: {
                id: "task-a",
                middleware: [
                  {
                    id: "custom.middleware.task.rateLimit",
                    config: {
                      identityScope: { tenant: false },
                    },
                    tags: [globalTags.identityScoped],
                  },
                ],
              },
            },
          ],
        ]),
        resources: new Map([
          [
            "resource-a",
            {
              resource: {
                id: "resource-a",
                subtree: {
                  middleware: {
                    identityScope: { tenant: false },
                  },
                },
              },
            },
          ],
        ]),
      },
      resolveReferenceId: (reference: unknown) =>
        typeof reference === "object" &&
        reference !== null &&
        "id" in reference &&
        typeof reference.id === "string"
          ? reference.id
          : null,
      findIdByDefinition: (reference: unknown) =>
        typeof reference === "object" &&
        reference !== null &&
        "id" in reference &&
        typeof reference.id === "string"
          ? reference.id
          : String(reference),
    } as unknown as ValidatorContext;

    expect(() => validateIdentityAsyncContextSupport(ctx)).not.toThrow();
  });
});
