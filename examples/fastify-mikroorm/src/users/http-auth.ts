import { FastifyRequest } from "fastify";

export function extractToken(
  req: FastifyRequest,
  cookieName: string,
): string | null {
  const authHeader =
    req.headers["authorization"] || req.headers["Authorization" as any];
  if (
    typeof authHeader === "string" &&
    authHeader.toLowerCase().startsWith("bearer ")
  ) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers["cookie"];
  if (typeof cookieHeader === "string") {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith(cookieName + "=")) {
        return decodeURIComponent(c.substring(cookieName.length + 1));
      }
    }
  }
  return null;
}
