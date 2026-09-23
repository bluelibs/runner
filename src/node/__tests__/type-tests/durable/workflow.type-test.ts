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

  const approved = r.event<{ approvedBy: string }>("types-approved").build();

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

      const signal = await ctx.waitForSignal(approved, {
        stepId: "await-approval",
      });
      const signalKind: "signal" = signal.kind;
      const approvedBy: string = signal.payload.approvedBy;
      void signalKind;
      void approvedBy;

      // @ts-expect-error no-timeout signal waits cannot resolve as timeout
      const impossibleTimeout: "timeout" = signal.kind;
      void impossibleTimeout;

      const signalWithTimeout = await ctx.waitForSignal(approved, {
        stepId: "await-approval-with-timeout",
        timeoutMs: 1_000,
      });
      if (signalWithTimeout.kind === "signal") {
        const timedApprovedBy: string = signalWithTimeout.payload.approvedBy;
        void timedApprovedBy;
      } else {
        const timeoutKind: "timeout" = signalWithTimeout.kind;
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

      type PageState = { page: number; total: number };
      // Patching requires initialized state, so full T is honest on reads.
      await ctx.replaceState<PageState>({ page: 0, total: 0 });
      await ctx.setState<PageState>({ page: 1 });
      const pageState = await ctx.getState<PageState>();
      const statePage: number | undefined = pageState?.page;
      const stateTotal: number | undefined = pageState?.total;
      void statePage;
      void stateTotal;

      // @ts-expect-error patches must match the state shape
      await ctx.setState<PageState>({ page: "one" });
      // @ts-expect-error replacements must be complete
      await ctx.replaceState<PageState>({ page: 2 });

      const attemptInfo = ctx.info();
      const infoAttempt: number = attemptInfo.attempt;
      const infoSteps: number = attemptInfo.stepCount;
      void infoAttempt;
      void infoSteps;

      const neverReturns: never = await ctx.continueAsNew({ hops: 1 });
      void neverReturns;

      return childResult;
    })
    .build();

  const app = r
    .resource("types-durable-workflow-app")
    .register([
      resources.durable,
      durableRegistration,
      approved,
      childWorkflow,
      childWorkflowWithoutInput,
      parentWorkflow,
    ])
    .build();

  void app;
  void parentWorkflow;
})();
