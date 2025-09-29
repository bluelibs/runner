import { r } from "@bluelibs/runner";
import type { FastifyReply, FastifyRequest } from "fastify";

export type RequestContext = {
  requestId: string;
  userId?: string | null;
  logger: any;
};

export type FastifyContext = {
  request: FastifyRequest;
  reply: FastifyReply;
};

export type AuthenticatedUser = { id: string; name: string; email: string };

export const fastifyContext = r
  .asyncContext<FastifyContext & RequestContext & { user?: AuthenticatedUser | null }>(
    "FastifyContext"
  )
  .build();
