import { r } from "../../../index";

const event = r.event<{ orderId: string }>("created").build();
const inventory = r
  .resource("inventory")
  .init(async () => ({ release: async (_id: string) => {} }))
  .build();
r.hook("reserve")
  .on(event)
  .dependencies({ inventory })
  .run(async (event) => ({ reservationId: event.data.orderId }))
  .order(1)
  .compensate(async (receipt, event, { inventory }) => {
    const orderId: string = event.data.orderId;
    await inventory.release(receipt.reservationId + orderId);
    // @ts-expect-error The receipt preserves the exact run result shape.
    await inventory.release(receipt.missing);
  })
  .build();
