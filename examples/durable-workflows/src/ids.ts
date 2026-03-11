/**
 * Shared event & resource definitions for the durable workflows example.
 */
import { r } from "@bluelibs/runner";
import {
  durableResource,
  MemoryStore,
  MemoryEventBus,
} from "@bluelibs/runner/node";

// ─── Durable backends (shared so tests/index.ts can inspect state) ───────────

export const store = new MemoryStore();
export const eventBus = new MemoryEventBus();

// ─── Durable resource (in-memory, worker enabled) ───────────────────────────

export const durable = durableResource.fork("durable");

export const durableRegistration = durable.with({
  store,
  eventBus,
  worker: true,
  polling: { interval: 50 },
});

// ─── Signals ─────────────────────────────────────────────────────────────────

/** Fired when a payment provider confirms a charge. */
export const PaymentConfirmed = r
  .event<{ transactionId: string }>("paymentConfirmed")
  .build();

/** Fired when a user clicks the verification link in their email. */
export const EmailVerified = r
  .event<{ verifiedAt: number }>("emailVerified")
  .build();
