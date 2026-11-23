import type { IEventBus } from "../interfaces/bus";
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

  if (eventBus) {
    return new Promise<TResult>((resolve, reject) => {
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      const attemptedChannels = new Set<string>();
      const subscribedChannels = new Set<string>();

      const unsubscribe = async (subscribed: string): Promise<void> => {
        try {
          await eventBus.unsubscribe(subscribed, refresh);
        } catch {
          // Bus cleanup must not delay a result retrieved from the store.
        }
      };

      const finalize = (
        out: { ok: true; value: TResult } | { ok: false; error: unknown },
      ): void => {
        if (done) return;
        done = true;
        clearTimeout(deadlineTimer);
        clearTimeout(pollTimer);
        for (const subscribed of subscribedChannels)
          void unsubscribe(subscribed);
        if (out.ok) resolve(out.value);
        else reject(out.error);
      };

      const subscribe = async (nextChannel: string): Promise<void> => {
        if (done || attemptedChannels.has(nextChannel)) return;
        attemptedChannels.add(nextChannel);
        try {
          await eventBus.subscribe(nextChannel, refresh);
        } catch {
          return; // The independent store poll is already running.
        }
        if (done) {
          // A pending handshake can finish after the caller has settled.
          void unsubscribe(nextChannel);
          return;
        }
        subscribedChannels.add(nextChannel);
        // Release obsolete continuation-hop channels once subscribed to the latest tip.
        for (const previous of [...subscribedChannels]) {
          if (previous !== nextChannel) {
            subscribedChannels.delete(previous);
            void unsubscribe(previous);
          }
        }
        // Close the read/subscribe gap, including when following a continuation.
        await refresh();
      };

      async function refresh(): Promise<void> {
        if (done) return;
        try {
          const result = await check();
          if (result.done) finalize({ ok: true, value: result.value });
          else void subscribe(result.channel);
        } catch (error) {
          finalize({ ok: false, error });
        }
      }

      const schedulePoll = (): void => {
        if (done) return;
        pollTimer = setTimeout(() => void pollOnce(), pollEveryMs);
        pollTimer.unref();
      };

      const pollOnce = async (): Promise<void> => {
        await refresh();
        schedulePoll();
      };

      if (timeoutMs !== undefined) {
        const remaining = timeoutMs - (Date.now() - startedAt);
        const deadline = async (): Promise<void> => {
          try {
            const result = await check();
            if (result.done) finalize({ ok: true, value: result.value });
            else finalize({ ok: false, error: await buildTimeoutError() });
          } catch (error) {
            finalize({ ok: false, error });
          }
        };
        if (remaining <= 0) {
          void deadline();
          return;
        }
        deadlineTimer = setTimeout(() => void deadline(), remaining);
        deadlineTimer.unref();
      }

      void subscribe(initialResult.channel);
      // Initial check() already ran; schedule the fallback poll after pollEveryMs.
      schedulePoll();
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
