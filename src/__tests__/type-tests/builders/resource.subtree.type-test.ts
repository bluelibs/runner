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
}
