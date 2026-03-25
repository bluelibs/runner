import { r, resources, tags } from "../../../../node";
import type { IsAny } from "../../../../types/resource";

type AssertFalse<T extends false> = T;

void (() => {
  const durable = resources.memoryWorkflow.fork("types-durable-subflow");
  const durableRegistration = durable.with({
    polling: { enabled: false },
  });

  const childWorkflow = r
    .task("types-durable-child")
    .tags([tags.durableWorkflow.with({ category: "tests" })])
    .inputSchema<{ orderId: string; amount: number }>({
      parse: (value: any) => value,
    })
    .run(async (input: { orderId: string; amount: number }) => ({
      paymentId: `${input.orderId}:${input.amount}`,
      settled: true as const,
    }))
    .build();

  const childWorkflowWithoutInput = r
    .task("types-durable-child-no-input")
    .tags([tags.durableWorkflow.with({ category: "tests" })])
    .run(async () => "ok" as const)
    .build();

  const parentWorkflow = r
    .task("types-durable-parent")
    .tags([tags.durableWorkflow.with({ category: "tests" })])
    .dependencies({ durable })
    .run(async (_input: undefined, { durable }) => {
      const ctx = durable.use();

      const childExecutionId: string = await ctx.workflow(
        "start-payment",
        childWorkflow,
        { orderId: "o-1", amount: 42 },
      );
      const childResult = await ctx.waitForExecution(
        childWorkflow,
        childExecutionId,
      );
      const childResultIsTyped: AssertFalse<IsAny<typeof childResult>> = false;
      void childResultIsTyped;

      const typedChildResult: {
        paymentId: string;
        settled: true;
      } = childResult;
      typedChildResult.paymentId;
      typedChildResult.settled;

      const childWithoutInputExecutionId: string = await ctx.workflow(
        "start-no-input",
        childWorkflowWithoutInput,
      );
      const childWithoutInputResult = await ctx.waitForExecution(
        childWorkflowWithoutInput,
        childWithoutInputExecutionId,
      );
      const childWithoutInputResultIsTyped: AssertFalse<
        IsAny<typeof childWithoutInputResult>
      > = false;
      void childWithoutInputResultIsTyped;
      const typedNoInputResult: "ok" = childWithoutInputResult;
      void typedNoInputResult;

      const timeoutOutcome = await ctx.waitForExecution(
        childWorkflow,
        childExecutionId,
        {
          timeoutMs: 1_000,
        },
      );

      if (timeoutOutcome.kind === "completed") {
        const typedCompleted: {
          paymentId: string;
          settled: true;
        } = timeoutOutcome.data;
        typedCompleted.paymentId;
      } else {
        const timeoutKind: "timeout" = timeoutOutcome.kind;
        void timeoutKind;
      }

      // @ts-expect-error required child input must be provided
      await ctx.workflow("missing-input", childWorkflow);

      await ctx.workflow(
        "bad-payment",
        childWorkflow,
        // @ts-expect-error wrong child input shape
        { orderId: 123, amount: "wrong" },
      );

      // @ts-expect-error waitForExecution returns the child result, not a string
      const mustBeString: string = await ctx.waitForExecution(
        childWorkflow,
        childExecutionId,
      );
      void mustBeString;

      // @ts-expect-error timeout-enabled waits return a union, not the plain child result
      const noUnionAllowed: { paymentId: string; settled: true } =
        await ctx.waitForExecution(childWorkflow, childExecutionId, {
          timeoutMs: 1_000,
        });
      void noUnionAllowed;

      return childResult;
    })
    .build();

  const app = r
    .resource("types-durable-workflow-app")
    .register([
      resources.durable,
      durableRegistration,
      childWorkflow,
      childWorkflowWithoutInput,
      parentWorkflow,
    ])
    .build();

  void app;
  void parentWorkflow;
})();
