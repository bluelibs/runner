import { AuthenticatedUserLike } from "./types";
import { db } from "../../../db/resources";
interface ExtractDeps {
  request: any; // FastifyRequest (kept as any to avoid hard dependency here)
  auth: { cookieName: string; verifyToken(token: string): any };
  db: any;
  extractToken: (request: any, cookieName: string) => string | null;
}

export async function extractAuthUser({
  request,
  auth,
  db,
  extractToken,
}: ExtractDeps): Promise<AuthenticatedUserLike | null> {
  try {
    const token = extractToken(request, auth.cookieName);
    const payload = token ? auth.verifyToken(token) : null;
    if (!payload) return null;
    const em = db.em();
    const entity = await em.findOne(db.entities.User, { id: payload.sub });
    if (!entity) return null;
    return { id: entity.id, name: entity.name, email: entity.email };
  } catch {
    return null; // graceful failure
  }
}
