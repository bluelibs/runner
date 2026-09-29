import type {
  IDurableContext,
  StepOptions,
  DurableStepConcurrency,
} from "../../../../node";

void (async (d: IDurableContext) => {
  const named: DurableStepConcurrency = { key: "provider", limit: 5 };
  const options: StepOptions = {
    concurrency: named,
    retries: 3,
    timeout: 1000,
  };
  const result: number = await d.step("named", options, async ({ signal }) => {
    signal.throwIfAborted();
    return 42;
  });
  await d.step("numeric", { concurrency: 5 }, async () => result);
  await d.step(
    "rate",
    { concurrency: { windowMs: 1000, max: 5 } },
    async () => result,
  );
  await d.step(
    "named-rate",
    { concurrency: { key: "provider-rate", windowMs: 1000, max: 5 } },
    async () => result,
  );
  await d.step(
    "mixed-policy",
    {
      // @ts-expect-error Concurrent caps and fixed-window policies are mutually exclusive.
      concurrency: { limit: 1, windowMs: 1000, max: 1 },
    },
    async () => result,
  );
  // @ts-expect-error Numeric concurrency is not a string.
  await d.step("invalid", { concurrency: "5" }, async () => result);
  await d.step(
    "missing-limit",
    // @ts-expect-error Named concurrency requires a limit.
    { concurrency: { key: "provider" } },
    async () => result,
  );
  await d.step(
    "old-name",
    // @ts-expect-error The public option is named concurrency.
    { admission: { concurrency: 5 } },
    async () => result,
  );
});
