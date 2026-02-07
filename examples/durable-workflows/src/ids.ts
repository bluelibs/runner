/**
 * Shared event & resource definitions for the durable workflows example.
 */
import {
  r,
  event,
  durableResource,
  MemoryStore,
  MemoryEventBus,
} from "@bluelibs/runner/node";

// ─── Durable backends (shared so tests/index.ts can inspect state) ───────────

export const store = new MemoryStore();
export const eventBus = new MemoryEventBus();

// ─── Durable resource (in-memory, worker enabled) ───────────────────────────

export const durable = durableResource.fork("example.durable");

export const durableRegistration = durable.with({
  store,
  eventBus,
  worker: true,
  polling: { interval: 50 },
});

// ─── Signals ─────────────────────────────────────────────────────────────────

/** Fired when a payment provider confirms a charge. */
export const PaymentConfirmed = event<{ transactionId: string }>({
  id: "example.signals.paymentConfirmed",
});

/** Fired when a user clicks the verification link in their email. */
export const EmailVerified = event<{ verifiedAt: number }>({
  id: "example.signals.emailVerified",
});
