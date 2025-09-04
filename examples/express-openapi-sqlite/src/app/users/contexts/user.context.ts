import { createContext } from "@bluelibs/runner";
import { UserSession } from "../types";

/**
 * User context for request-scoped user data.
 * This allows tasks to access the current authenticated user
 * throughout the request lifecycle.
 */
export const UserContext = createContext<UserSession>("user.session");
