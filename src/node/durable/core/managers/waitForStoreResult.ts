import type { IEventBus, BusEvent } from "../interfaces/bus";
import { sleepMs } from "../utils";
import { clearTimeout, setTimeout } from "node:timers";

/** A notification only nudges a fresh store read; polling covers missed messages. */
export async function waitForStoreResult<TResult>(params: {
  check: () => Promise<
    { done: false; channel: string } | { done: true; value: TResult }
  >;
  channel: string;
  eventBus?: IEventBus;
  startedAt: number;
  timeoutMs?: number;
  pollEveryMs: number;
  buildTimeoutError: () => Promise<Error>;
}): Promise<TResult> {
  const {
    check,
    channel,
    eventBus,
    startedAt,
    timeoutMs,
    pollEveryMs,
    buildTimeoutError,
  } = params;
  const throwIfTimedOut = async (): Promise<void> => {
    if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs)
      throw await buildTimeoutError();
  };
  const pollingFallback = async (): Promise<TResult> =>
    await pollUntilFinished({
      check,
      throwIfTimedOut,
      nextPollDelay: () =>
        timeoutMs === undefined
          ? pollEveryMs
          : Math.min(
              pollEveryMs,
              Math.max(0, timeoutMs - (Date.now() - startedAt)),
            ),
    });

  // Initial check
  const initialResult = await check();
  if (initialResult.done) return initialResult.value;

  // Use EventBus if available
  if (eventBus) {
    return new Promise<TResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      let skipEventBusSubscription = false;
      const channels = new Set([channel]);
      const subscribedEvent: BusEvent = {
        type: "subscribed",
        payload: null,
        timestamp: new Date(),
      };

      const handler = async (_event: BusEvent) => {
        try {
          const result = await check();
          if (result.done) {
            await finalize({ ok: true, value: result.value });
            return;
          }
          await followChannel(result.channel);
        } catch (err) {
          await finalize({ ok: false, error: err });
        }
      };

      const subscribe = async (channel: string): Promise<void> => {
        await eventBus.subscribe(channel, handler);
        // A slow subscription can become live after completion already cleaned up.
        if (done) await safeUnsubscribe();
      };

      // A continued run finishes on its tip, which publishes on its own
      // channel, so the waiter listens there too once the chain moves.
      const followChannel = async (tipChannel: string): Promise<void> => {
        if (done || channels.has(tipChannel)) return;
        channels.add(tipChannel);
        try {
          await subscribe(tipChannel);
        } catch {
          return; // Polling still covers the tip.
        }
        // The tip may have finished before the subscription was live.
        await handler(subscribedEvent);
      };

      const safeUnsubscribe = async (): Promise<void> => {
        for (const subscribed of channels) {
          try {
            await eventBus.unsubscribe(subscribed, handler);
          } catch {
            // ignore
          }
        }
      };

      const finalize = async (
        out: { ok: true; value: TResult } | { ok: false; error: unknown },
      ): Promise<void> => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        await safeUnsubscribe();

        if (out.ok) {
          resolve(out.value);
        } else {
          reject(out.error);
        }
      };

      // Preflight store check before wiring timers/subscriptions.
      // This reduces race windows and keeps timeout metadata checks consistent.
      void handler(subscribedEvent);

      if (timeoutMs !== undefined) {
        const elapsedMs = Date.now() - startedAt;
        const remainingTimeoutMs = timeoutMs - elapsedMs;

        const timeoutHandler = () => {
          void (async () => {
            try {
              await finalize({
                ok: false,
                error: await buildTimeoutError(),
              });
            } catch (err) {
              await finalize({ ok: false, error: err });
            }
          })();
        };

        if (remainingTimeoutMs <= 0) {
          skipEventBusSubscription = true;
          timeoutHandler();
        } else {
          timer = setTimeout(timeoutHandler, remainingTimeoutMs);
          timer.unref();
        }
      }

      const pollOnce = async (): Promise<void> => {
        try {
          const result = await check();
          if (done) return;
          if (result.done) {
            await finalize({ ok: true, value: result.value });
            return;
          }
          await throwIfTimedOut();
          /* istanbul ignore next -- another completion path may settle the wait during the timeout microtask turn */
          if (done) return;
        } catch (err) {
          await finalize({ ok: false, error: err });
          return;
        }

        const nextPollTimer = setTimeout(() => {
          pollTimer = null;
          if (done) {
            return;
          }
          void pollOnce();
        }, pollEveryMs);
        nextPollTimer.unref();

        pollTimer = nextPollTimer;
      };

      void (async () => {
        try {
          if (skipEventBusSubscription) {
            return;
          }
          await subscribe(channel);
          if (done) {
            return;
          }
          await handler(subscribedEvent);
          if (done) {
            return;
          }
          await pollOnce();
        } catch {
          // Fallback to polling if subscription fails
          await safeUnsubscribe();
          if (done) {
            return;
          }
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          void pollingFallback()
            .then((value) => finalize({ ok: true, value }))
            .catch((error: unknown) => finalize({ ok: false, error }));
        }
      })();
    });
  }

  return pollingFallback();
}

async function pollUntilFinished<TResult>(params: {
  check: () => Promise<
    { done: false; channel: string } | { done: true; value: TResult }
  >;
  throwIfTimedOut: () => Promise<void>;
  nextPollDelay: () => number;
}): Promise<TResult> {
  while (true) {
    const result = await params.check();
    if (result.done) return result.value;
    await params.throwIfTimedOut();

    await sleepMs(params.nextPollDelay());
  }
}
