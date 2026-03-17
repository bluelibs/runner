import {
  asyncContexts,
  defineResource,
  defineTask,
  middleware,
  r,
  run,
} from "../../";
import {
  identityAuthorizationError,
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../errors";

function identityValue(
  tenantId: string,
  userId?: string,
  roles?: string[],
): {
  tenantId: string;
  region: string;
  userId?: string;
  roles?: string[];
} {
  return {
    tenantId,
    region: `${tenantId}-region`,
    ...(userId === undefined ? {} : { userId }),
    ...(roles === undefined ? {} : { roles }),
  };
}

describe("run subtree task identity policy", () => {
  it("requires tenant identity by default when tasks.identity is present", async () => {
    const task = defineTask({
      id: "subtree-task-identity-default-tenant-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-task-identity-default-tenant-app",
      subtree: {
        tasks: {
          identity: {},
        },
      },
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(runtime.runTask(task)).rejects.toThrow(
      /Identity context is required/i,
    );
    await expect(
      asyncContexts.identity.provide(identityValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("treats user requirements as tenant plus user", async () => {
    const task = defineTask({
      id: "subtree-task-identity-user-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-task-identity-user-app",
      subtree: {
        tasks: {
          identity: { user: true },
        },
      },
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(identityValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/userId/i);
    await expect(
      asyncContexts.identity.provide(identityValue("acme", "u1"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("uses OR semantics for roles within one task identity gate", async () => {
    const task = defineTask({
      id: "subtree-task-identity-roles-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-task-identity-roles-app",
      subtree: {
        tasks: {
          identity: {
            roles: ["ADMIN", "CUSTOMER"],
          },
        },
      },
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(
        identityValue("acme", undefined, ["CUSTOMER"]),
        () => runtime.runTask(task),
      ),
    ).resolves.toBe("ok");

    let roleError: unknown;
    try {
      await asyncContexts.identity.provide(
        identityValue("acme", undefined, ["SUPPORT"]),
        () => runtime.runTask(task),
      );
    } catch (error) {
      roleError = error;
    }

    expect(identityAuthorizationError.is(roleError)).toBe(true);

    await runtime.dispose();
  });

  it("applies nested task identity gates additively across the owner chain", async () => {
    const task = defineTask({
      id: "subtree-task-identity-nested-task",
      run: async () => "ok",
    });
    const feature = defineResource({
      id: "subtree-task-identity-nested-feature",
      subtree: {
        tasks: {
          identity: { roles: ["SUPPORT"] },
        },
      },
      register: [task],
      init: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-task-identity-nested-app",
      subtree: {
        tasks: {
          identity: { roles: ["ADMIN"] },
        },
      },
      register: [feature],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(
        identityValue("acme", undefined, ["ADMIN", "SUPPORT"]),
        () => runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(
        identityValue("acme", undefined, ["ADMIN"]),
        () => runtime.runTask(task),
      ),
    ).rejects.toThrow(/required roles/i);

    await runtime.dispose();
  });

  it("coexists with explicit identityChecker middleware", async () => {
    const task = defineTask({
      id: "subtree-task-identity-coexists-task",
      middleware: [
        middleware.task.identityChecker.with({
          roles: ["ADMIN"],
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-task-identity-coexists-app",
      subtree: {
        tasks: {
          identity: { user: true },
        },
      },
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(
        identityValue("acme", "u1", ["ADMIN"]),
        () => runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(
        identityValue("acme", "u1", ["CUSTOMER"]),
        () => runtime.runTask(task),
      ),
    ).rejects.toThrow(/required roles/i);

    await runtime.dispose();
  });

  it("rejects unknown identityChecker config keys to match tasks.identity", () => {
    expect(() =>
      middleware.task.identityChecker.with({
        roles: ["ADMIN"],
        unexpected: true,
      } as never),
    ).toThrow();
  });

  it("uses the injected run identity context for task gates and identityChecker", async () => {
    const identity = r
      .asyncContext<{ tenantId: string; userId: string; roles: string[] }>(
        "subtree-task-identity-custom-context",
      )
      .configSchema({
        tenantId: String,
        userId: String,
        roles: [String],
      })
      .build();
    const task = defineTask({
      id: "subtree-task-identity-custom-context-task",
      middleware: [
        middleware.task.identityChecker.with({
          roles: ["ADMIN"],
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-task-identity-custom-context-app",
      subtree: {
        tasks: {
          identity: { user: true },
        },
      },
      register: [identity, task],
      init: async () => "ok",
    });

    const runtime = await run(app, { identity });

    let wrongContextError: unknown;
    try {
      await asyncContexts.identity.provide(
        identityValue("acme", "u1", ["ADMIN"]),
        () => runtime.runTask(task),
      );
    } catch (error) {
      wrongContextError = error;
    }

    expect(identityContextRequiredError.is(wrongContextError)).toBe(true);

    await expect(
      identity.provide(
        {
          tenantId: "acme",
          userId: "u1",
          roles: ["ADMIN"],
        },
        () => runtime.runTask(task),
      ),
    ).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("rejects invalid runtime role payloads from custom identity contexts", async () => {
    const identity = r
      .asyncContext<{
        tenantId: string;
        roles: unknown;
      }>("subtree-task-identity-invalid-roles-context")
      .build();
    const task = defineTask({
      id: "subtree-task-identity-invalid-roles-task",
      middleware: [middleware.task.identityChecker.with({ roles: ["ADMIN"] })],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-task-identity-invalid-roles-app",
      register: [identity, task],
      init: async () => "ok",
    });

    const runtime = await run(app, { identity });

    let invalidRolesError: unknown;
    try {
      await identity.provide(
        { tenantId: "acme", roles: [1] } as {
          tenantId: string;
          roles: unknown;
        },
        () => runtime.runTask(task),
      );
    } catch (error) {
      invalidRolesError = error;
    }

    expect(identityInvalidContextError.is(invalidRolesError)).toBe(true);

    await runtime.dispose();
  });
});
