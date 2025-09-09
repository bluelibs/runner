import { FastifyRequest, FastifyReply } from "fastify";
import { HTTPError } from "#/http/http-error";
import { Errors } from "@bluelibs/runner";

export function createErrorHandler() {
  return (err: Error, _req: FastifyRequest, reply: FastifyReply) => {
    // HTTPError thrown from tasks
    if (err instanceof HTTPError) {
      return reply
        .status(err.statusCode)
        .send({ error: err.message, details: err.details });
    }
    // Runner validation errors
    if (
      err instanceof Errors.ValidationError ||
      err?.name === "ValidationError"
    ) {
      return reply.status(400).send({ error: err.message });
    }
    // Errors with statusCode
    const status = (err as any)?.statusCode;
    if (typeof status === "number") {
      return reply.status(status).send({ error: err.message });
    }
    // Fallback
    reply.status(500).send({ error: "Internal Server Error" });
  };
}
