import { frameworkError } from "../../../definers/builders/error";

/** Settlement outside a consumer cannot select among concurrent duplicates. */
export const rabbitMQDeliveryAmbiguousError = frameworkError<{
  messageId: string;
}>("rabbitMQ-deliveryAmbiguous")
  .format(
    ({ messageId }) =>
      `Message "${messageId}" has multiple pending deliveries; settle it from its consumer handler.`,
  )
  .build();
