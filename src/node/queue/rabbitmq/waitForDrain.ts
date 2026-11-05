import { createCancellationErrorFromSignal } from "../../../tools/abortSignals";
import type { Channel } from "./RabbitMQTransport.types";

/** Stops a saturated publisher until its channel drains or is invalidated. */
export function waitForDrain(
  channel: Channel,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeListener!("drain", onDrain);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(createCancellationErrorFromSignal(signal));
    };
    channel.on!("drain", onDrain);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
