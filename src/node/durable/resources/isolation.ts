import { validationError } from "../../../errors";

function normalizePrefix(prefix: string): string {
  return prefix.endsWith(":") ? prefix : `${prefix}:`;
}

export interface DurableIsolation {
  namespace: string;
  encodedNamespace: string;
  storePrefix: string;
  busPrefix: string;
  queueName: string;
  deadLetterQueueName: string;
}

export function deriveDurableIsolation(params: {
  namespace: string;
  storePrefix?: string;
  busPrefix?: string;
  queueName?: string;
  deadLetterQueueName?: string;
}): DurableIsolation {
  if (params.namespace.trim().length === 0) {
    validationError.throw({
      subject: "Durable isolation namespace",
      id: "params.namespace",
      originalError: "must be a non-empty string",
    });
  }

  const encodedNamespace = encodeURIComponent(params.namespace);

  const storePrefix = normalizePrefix(
    params.storePrefix ?? `durable:${encodedNamespace}:`,
  );
  const busPrefix = normalizePrefix(
    params.busPrefix ?? `durable:bus:${encodedNamespace}:`,
  );

  return {
    namespace: params.namespace,
    encodedNamespace,
    storePrefix,
    busPrefix,
    queueName: params.queueName ?? `durable_executions:${encodedNamespace}`,
    deadLetterQueueName:
      params.deadLetterQueueName ??
      `durable_executions:dlq:${encodedNamespace}`,
  };
}
