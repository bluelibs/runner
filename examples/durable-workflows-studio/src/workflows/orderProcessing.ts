/**
 * Workflow 1: Order Processing.
 *
 * validate → charge → durable sleep → wait for payment signal → ship.
 * The sleep and signal waits are the interesting visual states: the studio
 * shows the execution parked with live countdown metadata.
 */
import { Match, r } from "@bluelibs/runner";
import { durableWorkflowTag } from "@bluelibs/runner/node";
import { durable } from "../server/studioIds.js";
import { PaymentConfirmed } from "./signals.js";

export interface OrderInput {
  orderId: string;
  customerId: string;
  amount: number;
  /** Durable sleep between charge and ship. Defaults to 3s for visibility. */
  processingDelayMs?: number;
}

export interface OrderResult {
  orderId: string;
  transactionId: string;
  status: "shipped";
  shippedAt: number;
}

export const orderInputSchema = Match.compile({
  orderId: Match.NonEmptyString,
  customerId: Match.NonEmptyString,
  amount: Match.Range({ min: 0, inclusive: false }),
  processingDelayMs: Match.Optional(
    Match.Range({ min: 0, integer: true }),
  ),
});

export const processOrder = r
  .task("processOrder")
  .inputSchema(orderInputSchema)
  .tags([
    durableWorkflowTag.with({
      key: "processOrder",
      category: "orders",
      signals: [PaymentConfirmed],
    }),
  ])
  .dependencies({ durable })
  .run(async (input: OrderInput, { durable }): Promise<OrderResult> => {
    const durableContext = durable.use();

    const validated = await durableContext.step("validateOrder", async () => {
      if (!input.orderId || input.amount <= 0) {
        throw new Error("Invalid order");
      }
      return {
        orderId: input.orderId,
        customerId: input.customerId,
        amount: input.amount,
        validatedAt: Date.now(),
      };
    });

    const charge = await durableContext.step("chargeCustomer", async () => ({
      chargeId: `chg_${validated.orderId}`,
      charged: validated.amount,
    }));

    await durableContext.sleep(input.processingDelayMs ?? 3000, {
      stepId: "processingDelay",
    });

    const confirmation = await durableContext.waitForSignal(PaymentConfirmed, {
      stepId: "awaitPaymentConfirmation",
    });
    if (confirmation.kind !== "signal") {
      throw new Error("Unreachable: a wait without timeout cannot time out.");
    }

    const shipment = await durableContext.step("shipOrder", async () => ({
      orderId: validated.orderId,
      transactionId: confirmation.payload.transactionId,
      status: "shipped" as const,
      shippedAt: Date.now(),
    }));

    await durableContext.note(
      `Order ${validated.orderId} shipped via charge ${charge.chargeId}`,
    );

    return shipment;
  })
  .build();
