import { r, tags } from "../../../../node";
import type { DurableContext, IDurableContext } from "../../../../node";

void ((context: IDurableContext, concrete: DurableContext) => {
  const event = r
    .event<{ orderId: string }>("placed")
    .tags([tags.durableEvent.with({ key: "orders.placed" })])
    .build();

  // @ts-expect-error The incomplete bus-notification API is no longer supported.
  context.emit(event, { orderId: "order-1" });
  // @ts-expect-error The implementation must not expose the removed API either.
  concrete.emit(event, { orderId: "order-1" });
  // @ts-expect-error Persistence keys must be strings.
  tags.durableEvent.with({ key: 42 });
});
