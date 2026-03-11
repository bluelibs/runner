import { r } from "@bluelibs/runner";
import { expressServerResource } from "./resources/express.resource";
import { routeRegistrationHook } from "./hooks/route-registration.hook";

export const http = r
  .resource("http")
  .register([expressServerResource, routeRegistrationHook])
  .build();
