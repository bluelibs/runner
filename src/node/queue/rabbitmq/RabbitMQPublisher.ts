import { createCancellationErrorFromSignal } from "../../../tools/abortSignals";
import type { Channel } from "./RabbitMQTransport.types";
import { waitForDrain } from "./waitForDrain";

type PublisherState = {
  controller: AbortController;
  drain?: Promise<void>;
};

/** Shares channel backpressure across publishers and invalidates stale waits. */
export class RabbitMQPublisher {
  private state: PublisherState = { controller: new AbortController() };

  reset(): void {
    this.close();
    this.state = { controller: new AbortController() };
  }

  close(): void {
    this.state.controller.abort();
  }

  async publish(
    channel: Channel,
    queue: string,
    content: Buffer,
    options: Record<string, unknown>,
    confirm: boolean,
  ): Promise<void> {
    const state = this.state;
    while (state.drain) await state.drain;
    if (state.controller.signal.aborted)
      throw createCancellationErrorFromSignal(state.controller.signal);

    if (channel.sendToQueue(queue, content, options) === false) {
      const pending = waitForDrain(channel, state.controller.signal);
      state.drain = pending;
      try {
        await pending;
      } finally {
        state.drain = undefined;
      }
    }
    if (confirm && typeof channel.waitForConfirms === "function") {
      await channel.waitForConfirms();
    }
  }
}
