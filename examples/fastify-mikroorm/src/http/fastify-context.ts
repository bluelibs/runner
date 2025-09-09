import { createContext } from "@bluelibs/runner";
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

export const fastifyContext = createContext<
  FastifyContext & RequestContext & { user?: AuthenticatedUser | null }
>(
  "FastifyContext",
);
