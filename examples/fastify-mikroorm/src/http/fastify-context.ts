import { createContext } from "@bluelibs/runner";
import type { FastifyReply, FastifyRequest } from "fastify";

export type FastifyContext = {
  request: FastifyRequest;
  reply: FastifyReply;
};

export const fastifyContext = createContext<FastifyContext>("FastifyContext");

