import { validationError } from "../../../errors";
import { deriveDurableIsolation } from "../../durable/resources/isolation";

describe("durable: isolation derivation", () => {
  it("derives names from namespace and encodes it", () => {
    const iso = deriveDurableIsolation({ namespace: "tenant A/1" });

    expect(iso.encodedNamespace).toBe("tenant%20A%2F1");
    expect(iso.storePrefix).toBe("durable:tenant%20A%2F1:");
    expect(iso.busPrefix).toBe("durable:bus:tenant%20A%2F1:");
    expect(iso.queueName).toBe("durable_executions:tenant%20A%2F1");
    expect(iso.deadLetterQueueName).toBe(
      "durable_executions:dlq:tenant%20A%2F1",
    );
  });

  it("normalizes store/bus prefixes to end with ':'", () => {
    const iso = deriveDurableIsolation({
      namespace: "x",
      storePrefix: "custom-store",
      busPrefix: "custom-bus:",
    });

    expect(iso.storePrefix).toBe("custom-store:");
    expect(iso.busPrefix).toBe("custom-bus:");
  });

  it("respects explicit queue names", () => {
    const iso = deriveDurableIsolation({
      namespace: "x",
      queueName: "q",
      deadLetterQueueName: "dlq",
    });

    expect(iso.queueName).toBe("q");
    expect(iso.deadLetterQueueName).toBe("dlq");
  });

  it("fails fast when namespace is blank", () => {
    let captured: unknown;
    try {
      deriveDurableIsolation({ namespace: "   " });
    } catch (error) {
      captured = error;
    }

    expect(validationError.is(captured)).toBe(true);
    expect((captured as Error).message).toContain(
      "Durable isolation namespace validation failed for params.namespace: must be a non-empty string",
    );
  });
});
