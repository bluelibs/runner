import { createContext } from "@bluelibs/runner";
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
