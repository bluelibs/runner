import { r } from "@bluelibs/runner";
/**
 * Request context for general request data.
 * Contains request ID, IP, user agent, etc.
 */
export interface RequestData {
  id: string;
  ip: string;
  userAgent?: string;
  timestamp: Date;
}

export const RequestContext = r
  .asyncContext<RequestData>("request")
  .build();
