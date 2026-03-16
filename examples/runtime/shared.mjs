import { asyncContexts, r, run } from "../../dist/universal/index.mjs";

const childTask = r
  .task("child")
  .run(async () => {
    const execution = asyncContexts.execution.use();

    return {
      correlationId: execution.correlationId,
      framesMode: execution.framesMode,
      hasSignal: execution.signal instanceof AbortSignal,
    };
  })
  .build();

const parentTask = r
  .task("parent")
  .dependencies({ childTask })
  .run(async (_input, deps) => {
    const parentExecution = asyncContexts.execution.use();
    const child = await deps.childTask();

    return {
      parentCorrelationId: parentExecution.correlationId,
      childCorrelationId: child.correlationId,
      sharedCorrelationId:
        parentExecution.correlationId === child.correlationId,
      inheritedSignal:
        child.hasSignal && parentExecution.signal instanceof AbortSignal,
      parentFramesMode: parentExecution.framesMode,
      childFramesMode: child.framesMode,
    };
  })
  .build();

const app = r.resource("app").register([childTask, parentTask]).build();

/**
 * Runs a tiny execution-context propagation smoke test against the built
 * universal bundle. It throws immediately if the runtime loses correlation id
 * or abort-signal inheritance across nested task calls.
 */
export async function runRuntimeExample(runtimeName) {
  const runtime = await run(app, {
    logs: { printThreshold: null },
    shutdownHooks: false,
    executionContext: true,
  });

  const controller = new AbortController();

  try {
    const result = await runtime.runTask(parentTask, undefined, {
      signal: controller.signal,
    });

    if (!result.sharedCorrelationId) {
      throw new Error(
        `${runtimeName} example failed: nested tasks lost correlation propagation.`,
      );
    }

    if (!result.inheritedSignal) {
      throw new Error(
        `${runtimeName} example failed: nested tasks lost abort-signal propagation.`,
      );
    }

    console.log(`${runtimeName} runtime example passed`, result);
    return result;
  } finally {
    await runtime.dispose();
  }
}
