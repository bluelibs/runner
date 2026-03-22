import { r, resources } from "../../../../node";
import type { IsAny } from "../../../../types/resource";

type AssertFalse<T extends false> = T;

void (() => {
  const durable = resources.memoryWorkflow.fork("types-durable-detail");
  const durableRegistration = durable.with({
    polling: { enabled: false },
  });

  const detailTask = r
    .task("types-durable-detail-task")
    .inputSchema<{ orderId: string }>({
      parse: (value: any) => value,
    })
    .run(async (input: { orderId: string }) => ({
      orderId: input.orderId,
      settled: true as const,
    }))
    .build();

  const inspectorTask = r
    .task("types-durable-detail-inspector")
    .dependencies({ durable })
    .run(async (_input: undefined, { durable }) => {
      const detail = await durable.getExecutionDetail(
        detailTask,
        "execution-1",
      );
      const executionIsTyped: AssertFalse<IsAny<typeof detail.execution>> =
        false;
      void executionIsTyped;

      if (detail.execution) {
        const typedInput:
          | {
              orderId: string;
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
    .resource("types-durable-detail-app")
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
