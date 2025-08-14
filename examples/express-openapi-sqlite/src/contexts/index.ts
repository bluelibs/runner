import { createContext } from "@bluelibs/runner";
import { UserSession } from "../types";

/**
 * User context for request-scoped user data.
 * This allows tasks to access the current authenticated user
 * throughout the request lifecycle.
 */
export const UserContext = createContext<UserSession>("user.session");

/**
 * Request context for general request data.
 * Contains request ID, IP, user agent, etc.
 */
export interface RequestData {
  requestId: string;
  ip: string;
  userAgent?: string;
  timestamp: Date;
}

export const RequestContext = createContext<RequestData>("request.data");