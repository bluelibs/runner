import { r, resources, tags } from "../../../../node";
import type { IsAny } from "../../../../types/resource";

type AssertFalse<T extends false> = T;

void (() => {
  const durable = resources.memoryWorkflow.fork("types-durable-repository");
  const durableRegistration = durable.with({
    polling: { enabled: false },
  });

  const detailTask = r
    .task("types-durable-repository-task")
    .inputSchema<{ orderId: string; order: { region: string } }>({
      parse: (value: any) => value,
    })
    .tags([tags.durableWorkflow.with({ category: "types" })])
    .run(async (input: { orderId: string; order: { region: string } }) => ({
      orderId: input.orderId,
      settled: true as const,
    }))
    .build();

  const inspectorTask = r
    .task("types-durable-repository-inspector")
    .dependencies({ durable })
    .run(async (_input: undefined, { durable }) => {
      const repository = durable.getRepository(detailTask);
      await repository.find(
        {
          input: { order: { region: "eu" } },
          createdAt: { $gte: new Date("2025-01-01T00:00:00.000Z") },
        },
        {
          sort: { createdAt: -1 },
          limit: 10,
          skip: 0,
        },
      );

      const detail = await repository.findOneOrFail({ id: "execution-1" });
      const executionIsTyped: AssertFalse<IsAny<typeof detail.execution>> =
        false;
      void executionIsTyped;

      if (detail.execution) {
        const typedInput:
          | {
              orderId: string;
              order: { region: string };
            }
          | undefined = detail.execution.input;
        const typedResult:
          | {
              orderId: string;
              settled: true;
            }
          | undefined = detail.execution.result;
        void typedInput;
        void typedResult;

        // @ts-expect-error result is not a string
        const badResult: string | undefined = detail.execution.result;
        void badResult;
      }

      return detail;
    })
    .build();

  const app = r
    .resource("types-durable-repository-app")
    .register([
      resources.durable,
      durableRegistration,
      detailTask,
      inspectorTask,
    ])
    .build();

  void app;
  void inspectorTask;
})();
