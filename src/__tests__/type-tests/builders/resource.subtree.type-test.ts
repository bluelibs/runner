import { r } from "../../../";
import { RunnerMode } from "../../../types/runner";

{
  const taskMiddleware = r.middleware
    .task("types-subtree-array-task-middleware")
    .run(async ({ next, task }) => next(task.input))
    .build();

  r.resource("types-subtree-static-array")
    .subtree([
      {
        tasks: {
          middleware: [taskMiddleware],
        },
      },
      {
        hooks: {},
      },
    ])
    .build();

  r.resource<{ enabled: boolean }>("types-subtree-dynamic-array")
    .subtree((config, mode) => {
      const runtimeMode: RunnerMode | undefined = mode;
      void runtimeMode;
      // @ts-expect-error mode remains a strict union
      const invalidMode: "staging" = mode;
      void invalidMode;

      return [
        {
          validate: [],
        },
        {
          tasks: {
            middleware: [],
            validate: config.enabled ? [() => []] : [],
          },
        },
      ];
    })
    .build();

  r.resource("types-subtree-invalid-array")
    .subtree([
      {
        validate: [],
      },
      // @ts-expect-error subtree arrays accept only subtree policy objects
      "invalid-policy-entry",
    ])
    .build();

  r.resource("types-subtree-task-identity-scope")
    .subtree({
      middleware: {
        identityScope: { tenant: true, user: true },
      },
    })
    .build();

  r.resource("types-subtree-task-identity-scope-invalid")
    .subtree({
      middleware: {
        // @ts-expect-error subtree task identityScope requires tenant: true
        identityScope: { user: true },
      },
    })
    .build();

  r.resource("types-subtree-task-identity-gate")
    .subtree({
      tasks: {
        identity: { user: true, roles: ["ADMIN", "CUSTOMER"] },
      },
    })
    .build();

  r.resource("types-subtree-task-identity-gate-tenant-default")
    .subtree({
      tasks: {
        identity: { roles: ["ADMIN"] },
      },
    })
    .build();

  r.resource("types-subtree-task-identity-gate-invalid")
    .subtree({
      tasks: {
        identity: {
          // @ts-expect-error subtree task identity roles must be string[]
          roles: [1],
        },
      },
    })
    .build();
}
