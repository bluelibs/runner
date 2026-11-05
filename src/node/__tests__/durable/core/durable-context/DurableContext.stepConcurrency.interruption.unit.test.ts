import { cancellationError } from "../../../../../errors";
import {
  EXECUTION_PAUSED_ABORT_REASON,
  isDurablePauseInterruptionError,
} from "../../../../durable/core/pauseInterruption";
import { isDurableShutdownInterruptionError } from "../../../../durable/core/shutdownInterruption";
import { runtimeShutdownAbortReason } from "../../../../../tools/runtimeShutdownAbortReason";
import { gate, stepFixture } from "./stepConcurrency.helpers";

it.each([EXECUTION_PAUSED_ABORT_REASON, runtimeShutdownAbortReason])(
  "retains the typed interruption when %s races permit acquisition",
  async (reason) => {
    const caller = new AbortController();
    const { ctx, store } = await stepFixture({
      contextOptions: { cancellationSignal: caller.signal },
    });
    const entered = gate();
    let respond!: (grant: string | null) => void;
    jest.spyOn(store, "acquireLock").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
          entered.open();
        }),
    );
    const body = jest.fn(async () => 42);
    const failure = ctx
      .step("charge", { concurrency: 1 }, body)
      .catch((error: unknown) => error);
    await entered.promise;
    // A quick resume may already have restored the running record when acquisition rejects.
    caller.abort(reason);
    const error: unknown = await failure;
    expect(cancellationError.is(error, { reason })).toBe(true);
    if (reason === EXECUTION_PAUSED_ABORT_REASON)
      expect(isDurablePauseInterruptionError(error)).toBe(true);
    else expect(isDurableShutdownInterruptionError(error, reason)).toBe(true);
    expect(body).not.toHaveBeenCalled();
    expect((await store.getExecution("execution"))?.status).toBe("running");
    respond(null);
  },
);
